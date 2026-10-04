import type { Element } from "hast";
import { type TextBlock, ancestorsOf } from "./blocks";

/**
 * A small sequence model over a page's blocks: each block's feature row, hashed words and
 * character bigrams of its text and hashed tag/class tokens of its nearest ancestors are encoded,
 * a two-layer bidirectional GRU reads the page in order, and a linear head gives the probability
 * that the block is main content. It sees what the GBDT cannot: the words themselves and the run
 * of the page around each block.
 *
 * Weights are stored as int8 rows with one scale each (see `neural-model.generated.ts`).
 */

export interface QuantizedMatrix {
	rows: number;
	cols: number;
	/** One scale per row. */
	scale: number[];
	/** Row-major int8 values, base64. */
	data: string;
}

export interface NeuralModel {
	kind: "block-gru";
	buckets: number;
	emb: number;
	hidden: number;
	features: number;
	mean: number[];
	std: number[];
	matrices: Record<string, QuantizedMatrix>;
	vectors: Record<string, number[]>;
}

interface Dense {
	rows: number;
	cols: number;
	values: Float32Array;
}

const decode = (matrix: QuantizedMatrix): Dense => {
	const bytes = Uint8Array.from(atob(matrix.data), (char) => char.charCodeAt(0));
	const values = new Float32Array(matrix.rows * matrix.cols);
	for (let row = 0; row < matrix.rows; row++) {
		const scale = matrix.scale[row];
		for (let col = 0; col < matrix.cols; col++) {
			const index = row * matrix.cols + col;
			const byte = bytes[index];
			values[index] = (byte > 127 ? byte - 256 : byte) * scale;
		}
	}
	return { rows: matrix.rows, cols: matrix.cols, values };
};

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

/** CRC-32 state after `text`'s UTF-8 bytes, starting from `crc` (code points, no allocation). */
const crcUpdate = (crc: number, text: string): number => {
	let state = crc;
	const push = (byte: number) => {
		state = CRC_TABLE[(state ^ byte) & 0xff] ^ (state >>> 8);
	};
	for (let index = 0; index < text.length; index++) {
		let code = text.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const low = text.charCodeAt(index + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
				index += 1;
			}
		}
		if (code < 0x80) {
			push(code);
		} else if (code < 0x800) {
			push(0xc0 | (code >> 6));
			push(0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			push(0xe0 | (code >> 12));
			push(0x80 | ((code >> 6) & 0x3f));
			push(0x80 | (code & 0x3f));
		} else {
			push(0xf0 | (code >> 18));
			push(0x80 | ((code >> 12) & 0x3f));
			push(0x80 | ((code >> 6) & 0x3f));
			push(0x80 | (code & 0x3f));
		}
	}
	return state;
};

/** zlib's CRC-32 of `prefix + text` in UTF-8, as the trainer hashes tokens; the prefix state is reusable. */
const crcStart = (prefix: string): number => crcUpdate(0xffffffff, prefix);
const crcFinish = (state: number, text: string): number => (crcUpdate(state, text) ^ 0xffffffff) >>> 0;

const WORD_PREFIX = crcStart("w:");
const BIGRAM_PREFIX = crcStart("c:");
const CLASS_PREFIX = crcStart("k:");
const DEPTH_PREFIXES = [0, 1, 2, 3, 4].map((depth) => ({ tag: crcStart(`t${depth}:`), cls: crcStart(`k${depth}:`) }));

const WORD = /[\p{L}\p{N}]+/gu;
const MAX_WORDS = 40;
const MAX_BIGRAMS = 120;

/** Hashed words and character bigrams of a block's text (the first 300 characters). */
export const textTokens = (text: string, buckets: number): number[] => {
	const lower = text.slice(0, 300).toLowerCase();
	const out: number[] = [];
	for (const word of (lower.match(WORD) ?? []).slice(0, MAX_WORDS)) {
		out.push(crcFinish(WORD_PREFIX, word) % buckets);
	}
	const compact = Array.from(lower.replace(/ /g, ""));
	for (let index = 0; index < Math.min(compact.length - 1, MAX_BIGRAMS); index++) {
		out.push(crcFinish(BIGRAM_PREFIX, compact[index] + compact[index + 1]) % buckets);
	}
	return out.length > 0 ? out : [0];
};

const describe = (element: Element): string[] => {
	const className = element.properties?.className;
	const classes = Array.isArray(className) ? className.map(String) : [];
	const id = typeof element.properties?.id === "string" ? [`#${element.properties.id}`] : [];
	return [element.tagName, ...classes, ...id];
};

/** Hashed tokens of one element at one depth of the window (cached: siblings share ancestors). */
const elementTokens = (element: Element, depth: number, buckets: number, cache: Map<Element, number[][]>): number[] => {
	let byDepth = cache.get(element);
	if (!byDepth) {
		byDepth = [];
		cache.set(element, byDepth);
	}
	const cached = byDepth[depth];
	if (cached) {
		return cached;
	}
	const out: number[] = [];
	const parts = describe(element).join(" ").split(/\s+/).filter(Boolean);
	if (parts.length > 0) {
		const prefixes = DEPTH_PREFIXES[depth];
		out.push(crcFinish(prefixes.tag, parts[0]) % buckets);
		for (const token of parts.slice(1, 6)) {
			for (const piece of token.replace(/_/g, "-").toLowerCase().split("-").slice(0, 4)) {
				if (piece) {
					out.push(crcFinish(CLASS_PREFIX, piece) % buckets);
					out.push(crcFinish(prefixes.cls, piece) % buckets);
				}
			}
		}
	}
	byDepth[depth] = out;
	return out;
};

/** Hashed, depth-tagged tag and class tokens of the block's owner and its 4 nearest block ancestors. */
export const classTokens = (block: TextBlock, buckets: number, cache = new Map<Element, number[][]>()): number[] => {
	const out: number[] = [];
	ancestorsOf(block)
		.slice(-5)
		.forEach((element, depth) => {
			out.push(...elementTokens(element as Element, depth, buckets, cache));
		});
	return out.length > 0 ? out : [0];
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

/** out += W · input (+ bias), W rows × cols. */
const affine = (
	w: Dense,
	bias: number[] | undefined,
	input: Float32Array,
	inputOffset: number,
	out: Float32Array,
): void => {
	const { rows, cols, values } = w;
	for (let row = 0, base = 0; row < rows; row++, base += cols) {
		let sum = bias === undefined ? 0 : bias[row];
		for (let col = 0; col < cols; col++) {
			sum += values[base + col] * input[inputOffset + col];
		}
		out[row] = sum;
	}
};

interface Layer {
	ih: Dense;
	hh: Dense;
	bih: number[];
	bhh: number[];
}

/** One direction of a GRU layer over `count` rows of `input` (width `width`), writing `hidden` columns at `outOffset`. */
const runGru = (
	layer: Layer,
	input: Float32Array,
	width: number,
	count: number,
	hidden: number,
	reverse: boolean,
	output: Float32Array,
	outWidth: number,
	outOffset: number,
): void => {
	const h = new Float32Array(hidden);
	const gi = new Float32Array(3 * hidden);
	const gh = new Float32Array(3 * hidden);
	for (let step = 0; step < count; step++) {
		const t = reverse ? count - 1 - step : step;
		affine(layer.ih, layer.bih, input, t * width, gi);
		affine(layer.hh, layer.bhh, h, 0, gh);
		for (let k = 0; k < hidden; k++) {
			const r = sigmoid(gi[k] + gh[k]);
			const z = sigmoid(gi[hidden + k] + gh[hidden + k]);
			const n = Math.tanh(gi[2 * hidden + k] + r * gh[2 * hidden + k]);
			h[k] = (1 - z) * n + z * h[k];
			output[t * outWidth + outOffset + k] = h[k];
		}
	}
};

interface Prepared {
	model: NeuralModel;
	num: Dense;
	text: Dense;
	cls: Dense;
	mix: Dense;
	out: Dense;
	layers: Layer[][];
}

const prepared = new WeakMap<NeuralModel, Prepared>();

const prepare = (model: NeuralModel): Prepared => {
	const cached = prepared.get(model);
	if (cached) {
		return cached;
	}
	const m = (name: string) => decode(model.matrices[name]);
	const layer = (suffix: string): Layer => ({
		ih: m(`rnn.weight_ih_${suffix}`),
		hh: m(`rnn.weight_hh_${suffix}`),
		bih: model.vectors[`rnn.bias_ih_${suffix}`],
		bhh: model.vectors[`rnn.bias_hh_${suffix}`],
	});
	const result: Prepared = {
		model,
		num: m("num.0.weight"),
		text: m("text.weight"),
		cls: m("cls.weight"),
		mix: m("mix.0.weight"),
		out: m("out.weight"),
		layers: [0, 1, 2, 3]
			.filter((index) => model.matrices[`rnn.weight_ih_l${index}`] !== undefined)
			.map((index) => [layer(`l${index}`), layer(`l${index}_reverse`)]),
	};
	prepared.set(model, result);
	return result;
};

/** True when the model's shapes match the feature rows it will be given. */
export const isUsableNeuralModel = (model: NeuralModel | undefined, featureCount: number): model is NeuralModel =>
	model !== undefined &&
	model.kind === "block-gru" &&
	model.features === featureCount &&
	model.mean.length === featureCount;

const addBag = (table: Dense, tokens: number[], out: Float32Array, offset: number): void => {
	const width = table.cols;
	const inverse = 1 / tokens.length;
	for (const token of tokens) {
		const base = token * width;
		for (let k = 0; k < width; k++) {
			out[offset + k] += table.values[base + k] * inverse;
		}
	}
};

/** Probability of main content for every block, from its feature row and the page around it. */
export const scoreBlocksNeural = (
	blocks: TextBlock[],
	features: Float32Array,
	featureCount: number,
	model: NeuralModel,
): Float32Array => {
	const p = prepare(model);
	const count = blocks.length;
	const hidden = model.hidden;
	const emb = model.emb;
	const numWidth = p.num.rows;
	const mixIn = numWidth + 2 * emb;
	const blockVectors = new Float32Array(count * hidden);
	const row = new Float32Array(featureCount);
	const numOut = new Float32Array(numWidth);
	const mixInput = new Float32Array(mixIn);
	const mixOut = new Float32Array(hidden);
	const numBias = model.vectors["num.0.bias"];
	const mixBias = model.vectors["mix.0.bias"];
	const classCache = new Map<Element, number[][]>();
	for (const block of blocks) {
		const index = block.index;
		for (let k = 0; k < featureCount; k++) {
			row[k] = (features[index * featureCount + k] - model.mean[k]) / model.std[k];
		}
		affine(p.num, numBias, row, 0, numOut);
		mixInput.fill(0);
		for (let k = 0; k < numWidth; k++) {
			mixInput[k] = Math.max(0, numOut[k]);
		}
		addBag(p.text, textTokens(block.text, model.buckets), mixInput, numWidth);
		addBag(p.cls, classTokens(block, model.buckets, classCache), mixInput, numWidth + emb);
		affine(p.mix, mixBias, mixInput, 0, mixOut);
		for (let k = 0; k < hidden; k++) {
			blockVectors[index * hidden + k] = Math.max(0, mixOut[k]);
		}
	}

	let input = blockVectors;
	let width = hidden;
	for (const [forward, backward] of p.layers) {
		const output = new Float32Array(count * 2 * hidden);
		runGru(forward, input, width, count, hidden, false, output, 2 * hidden, 0);
		runGru(backward, input, width, count, hidden, true, output, 2 * hidden, hidden);
		input = output;
		width = 2 * hidden;
	}

	const out = new Float32Array(count);
	const outBias = model.vectors["out.bias"][0];
	for (let index = 0; index < count; index++) {
		let sum = outBias;
		for (let k = 0; k < 2 * hidden; k++) {
			sum += p.out.values[k] * input[index * 2 * hidden + k];
		}
		for (let k = 0; k < hidden; k++) {
			sum += p.out.values[2 * hidden + k] * blockVectors[index * hidden + k];
		}
		out[index] = sigmoid(sum);
	}
	return out;
};
