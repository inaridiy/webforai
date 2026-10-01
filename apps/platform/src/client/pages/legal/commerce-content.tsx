import type { ReactNode } from "react";

const DISCLOSED_ON_REQUEST = "請求があった場合、遅滞なく開示いたします。";

const entries: { label: string; value: ReactNode }[] = [
	{ label: "販売事業者", value: "稲垣凛太郎（屋号: 稲荷屋）" },
	{ label: "運営責任者", value: "稲垣凛太郎" },
	{ label: "所在地", value: DISCLOSED_ON_REQUEST },
	{ label: "電話番号", value: DISCLOSED_ON_REQUEST },
	{ label: "メールアドレス", value: <a href="mailto:support@webforai.dev">support@webforai.dev</a> },
	{ label: "販売URL", value: <a href="https://platform.webforai.dev">https://platform.webforai.dev</a> },
	{
		label: "販売価格",
		value: (
			<>
				クレジット単位の従量課金です。毎月 1,000
				クレジットまでは無料で、これを超える利用分は、利用量に応じて段階的に単価が変わる料金（米ドル建て）で計算されます。各価格帯の単価は
				<a href="/#pricing">料金セクション</a>に記載のとおりです。表示価格はお支払いいただく総額（税込）です。
			</>
		),
	},
	{
		label: "消費税・インボイス",
		value:
			"当方は消費税の免税事業者です。当方は適格請求書発行事業者ではないため、適格請求書（インボイス）は発行できません。Stripe から送付される請求書・領収書も適格請求書ではありません。",
	},
	{
		label: "有料利用の内容と利用上限",
		value:
			'プロキシエンジン（proxy-fetch、proxy-browser、および region: "jp" の指定など、これらで実行されるリクエスト）は有料利用（サブスクリプション）でのみご利用いただけます。有料利用には月間の利用上限額があり、初期値は 50 米ドル、ダッシュボードで 1〜5,000 米ドルの範囲で変更できます。上限に達すると、その請求月の間（または上限額を引き上げるまで）課金対象のリクエストは受け付けられません。',
	},
	{
		label: "商品代金以外の必要料金",
		value: "本サービスの利用に必要なインターネット接続料金・通信料金等はお客様のご負担となります。",
	},
	{ label: "支払方法", value: "クレジットカード（Stripe）" },
	{
		label: "支払時期",
		value:
			"利用料金はご契約の請求期間（1か月）ごとに集計し、各期間の終了後に Stripe を通じてご登録のクレジットカードへ請求します。",
	},
	{ label: "役務の提供時期", value: "アカウント登録後、すぐにご利用いただけます。" },
	{
		label: "返品・キャンセル",
		value:
			"デジタル役務の性質上、提供済みの役務に対する返品・返金はお受けできません。有料利用の解約はダッシュボードからいつでも行えます。解約後は無料枠の範囲でのみご利用いただけます。解約前に発生した利用料金はお支払いいただきます。",
	},
	{
		label: "動作環境",
		value:
			"ダッシュボード: 最新版の主要ウェブブラウザ（Google Chrome、Microsoft Edge、Firefox、Safari 等）。API: HTTPS で通信できる環境。",
	},
];

export const CommerceContent = ({ className }: { className?: string }) => (
	<article className={className}>
		<h1>特定商取引法に基づく表記</h1>
		<p>Effective: 2026-10-01</p>
		<p>クロール・Markdown 変換 API「webforai platform」に関する特定商取引法に基づく表記です。</p>
		{/* A table, not a <dl>: webforai's extractor (and so the prerender gate) drops <dl> content. */}
		<table>
			<tbody>
				{entries.map((entry) => (
					<tr key={entry.label}>
						<th scope="row">{entry.label}</th>
						<td>{entry.value}</td>
					</tr>
				))}
			</tbody>
		</table>
	</article>
);
