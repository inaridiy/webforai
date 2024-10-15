import type { Nodes as Hast } from "hast";

export type ExtractParams = { hast: Hast; lang?: string; url?: string };
export type Extractor = (param: ExtractParams) => Hast;
