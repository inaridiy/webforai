export const TermsContent = ({ className }: { className?: string }) => (
	<article className={className}>
		<h1>Terms of Service</h1>
		<p>Effective: 2026-10-01</p>

		<h2>1. About these terms</h2>
		<p>
			These Terms of Service (the “Terms”) govern your use of webforai platform at https://platform.webforai.dev,
			including its website, dashboard and API (the “Service”). The Service is operated by an individual developer based
			in Japan (“we”, “us”). By creating an account, using an API key or otherwise using the Service, you agree to these
			Terms and to our Privacy Policy. The sign-in page links to both and states this before you continue. If you use
			the Service on behalf of an organization, you confirm that you are authorized to accept these Terms for it.
		</p>
		<p>
			The webforai library and the code of this platform are open source under the Apache License 2.0 and can be
			self-hosted. That license governs the source code. These Terms govern only the hosted Service that we operate.
		</p>

		<h2>2. What the Service does</h2>
		<p>
			The Service fetches web pages that you request (through scrape, batch or crawl jobs) and converts them to
			Markdown. It can optionally capture screenshots and re-host images found on those pages. The Service acts only on
			your instructions. We do not select, inspect, curate or endorse the content that is fetched, and we are not
			responsible for it.
		</p>

		<h2>3. Accounts and API keys</h2>
		<ul>
			<li>You sign in with a one-time code sent to your email address, or with GitHub.</li>
			<li>
				You are responsible for keeping access to your email account, your GitHub account and your API keys secure. All
				activity under your account or your API keys is treated as yours, including the credits it uses.
			</li>
			<li>Tell us promptly at support@webforai.dev if you believe your account or an API key has been compromised.</li>
			<li>You must provide an email address that you control and keep it up to date.</li>
			<li>An account can have up to 50 API keys.</li>
		</ul>

		<h2>4. Your responsibility for what you fetch</h2>
		<p>
			You are solely responsible for the URLs you submit, the jobs you run and how you use the results. In particular,
			you are responsible for:
		</p>
		<ul>
			<li>
				having any rights and permissions needed to access, copy, store and use the content you fetch, including
				copyright and other intellectual property rights;
			</li>
			<li>complying with the terms of use and access policies of the sites you fetch from;</li>
			<li>
				the settings you choose for each job, including whether to honor robots.txt, crawl limits and the fetching
				engine used;
			</li>
			<li>
				complying with all laws that apply to you, your jobs and your use of the results, including laws on copyright,
				personal information and unauthorized computer access.
			</li>
		</ul>
		<p>
			If fetched content contains personal information, you are responsible for having a lawful basis to collect and use
			it.
		</p>
		<p>
			Crawl jobs honor the target site’s robots.txt by default. For scrape and batch requests, honoring robots.txt is an
			option you turn on per request. Pages that robots.txt disallows fail without being fetched or billed. Turning this
			option off, or a site having no robots.txt, does not relieve you of the responsibilities above.
		</p>

		<h2>5. Prohibited use</h2>
		<p>You must not use the Service to:</p>
		<ul>
			<li>break any law or infringe the rights of others;</li>
			<li>
				access content or systems you are not authorized to access, including by getting around logins, paywalls or
				other access controls;
			</li>
			<li>send traffic that disrupts or overloads a target site, or otherwise attack any system;</li>
			<li>distribute malware or use the Service as part of fraud, phishing or spam;</li>
			<li>
				interfere with the Service, probe or bypass its security, rate limits or usage metering, or share API keys in
				order to avoid charges or limits.
			</li>
		</ul>

		<h2>6. Credits, fees and billing</h2>
		<ul>
			<li>Usage of the Service is metered in credits. Each account receives 1,000 free credits per month.</li>
			<li>
				Usage beyond the free credits is charged per credit at the graduated prices shown in the pricing section of the
				website, and billed monthly in arrears through Stripe. Prices are in US dollars and are the total amounts you
				pay; no consumption tax is added on top. By adding a payment method, you authorize us to charge it for your
				usage.
			</li>
			<li>
				Payments are processed by Stripe. We do not receive or store your full card number. Your use of Stripe is also
				subject to Stripe’s terms.
			</li>
			<li>
				We may change prices by updating the pricing section. Changed prices apply to usage after the change takes
				effect, not to usage already incurred.
			</li>
			<li>
				Fees are non-refundable, except where refunds are required by applicable law. Usage incurred before you cancel
				paid usage or delete your account remains payable.
			</li>
			<li>
				If a payment fails or remains unpaid, we may limit your account to the free credits, or suspend it, until the
				balance is paid.
			</li>
		</ul>

		<h2>7. Plans, spend cap and limits</h2>
		<ul>
			<li>
				Without a subscription, you can use the free credits with the <code>auto</code>, <code>fetch</code> and{" "}
				<code>browser</code> engines. The proxy engines (<code>proxy-fetch</code>, <code>proxy-browser</code>, and any
				request that runs on them, such as one with <code>"region": "jp"</code>) require an active paid subscription.
			</li>
			<li>
				Each subscription has a monthly spend cap. It is US$50 by default, and you can change it in the dashboard to any
				amount from US$1 to US$5,000. When your usage for the billing month reaches the cap, the Service stops accepting
				billable requests from your account until the next billing month or until you raise the cap. Usage is metered as
				requests and job pages complete, so work already in progress can take the total slightly past the cap; that
				usage is payable.
			</li>
			<li>
				To keep the Service available to everyone, we apply rate limits per account. Currently these are 60 requests per
				minute without a subscription and 600 requests per minute with one, and up to 3 (without a subscription) or 20
				(with one) batch and crawl jobs running at the same time. Requests over a limit are rejected and not billed. We
				may adjust these limits to protect the Service; the current values are shown in the documentation.
			</li>
		</ul>

		<h2>8. Results and data retention</h2>
		<p>
			Job results, screenshots and re-hosted images are kept for up to 7 days and then deleted automatically. Results of
			the public demo may be cached for up to 10 minutes. The Service is not a storage or archiving service. You are
			responsible for saving copies of any results you want to keep.
		</p>
		<p>
			We do not look into the contents of your jobs, except as needed to operate, secure or debug the Service, or when
			required by law. How we handle personal information is described in our Privacy Policy.
		</p>

		<h2>9. Rights in content</h2>
		<p>
			We claim no ownership of the content you fetch or of the results. Any rights in that content belong to its owners.
			You grant us the limited permission needed to fetch, process, store and deliver that content in order to run your
			jobs and operate the Service.
		</p>

		<h2>10. Availability and changes to the Service</h2>
		<p>
			The Service is provided without any service level agreement. We may change, limit or discontinue any part of the
			Service at any time, and it may be unavailable from time to time for maintenance, failures or other reasons. The
			Service relies on third-party infrastructure and on the target sites themselves, so individual fetches may fail or
			return incomplete results.
		</p>

		<h2>11. Suspension and termination</h2>
		<ul>
			<li>
				We may suspend or terminate your access to the Service, or remove API keys or jobs, with or without notice, if
				we reasonably believe that you have violated these Terms, that your use is abusive or creates legal, security or
				operational risk, or that payment is overdue.
			</li>
			<li>
				You may stop using the Service at any time and may delete your account from the dashboard. Deleting your account
				does not cancel fees for usage already incurred.
			</li>
			<li>
				Sections 4, 6 (for amounts owed), 9 and 12 through 16 survive any suspension, termination or account deletion.
			</li>
		</ul>

		<h2>12. Disclaimer of warranties</h2>
		<p>
			The Service and all results are provided “as is” and “as available”. To the maximum extent permitted by law, we
			disclaim all warranties, express or implied, including warranties of merchantability, fitness for a particular
			purpose, accuracy, completeness and non-infringement. We do not warrant that the Service will be uninterrupted or
			error-free, that any site can be fetched, or that conversions, screenshots or re-hosted images will be accurate or
			complete. This section does not limit our liability for our intentional misconduct or gross negligence, or any
			liability that cannot be excluded under applicable law, including the Consumer Contract Act of Japan.
		</p>

		<h2>13. Limitation of liability</h2>
		<p>
			The exclusions and limits in this section apply only where the damage was caused without intent or gross
			negligence on our part (that is, through ordinary negligence or without fault). They never apply to damage caused
			by our intentional misconduct or gross negligence (故意又は重大な過失), for which we are liable as provided by
			law.
		</p>
		<p>
			Subject to the paragraph above and to the maximum extent permitted by law, we are not liable for any indirect,
			incidental, special, consequential or punitive damages, or for any loss of profits, revenue, data or business
			opportunity, arising from or related to the Service or these Terms, even if we were advised of the possibility of
			such damages.
		</p>
		<p>
			Subject to the first paragraph of this section and to the maximum extent permitted by law, our total liability for
			all claims arising from or related to the Service or these Terms is limited to the lower of (a) the fees you paid
			us for the Service in the 3 months before the event giving rise to the claim, or (b) 10,000 Japanese yen.
		</p>
		<p>
			Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law. If a
			mandatory law, such as the Consumer Contract Act of Japan, prevents any part of this section from applying to you,
			that part applies only to the extent permitted.
		</p>

		<h2>14. Indemnification</h2>
		<p>
			You agree to defend, indemnify and hold us harmless from and against any claims, damages, losses, liabilities,
			costs and expenses (including reasonable attorneys’ fees) arising from or related to your jobs, the content you
			fetch, your use of the results, your violation of these Terms, or your violation of any law or the rights of any
			third party, to the extent they are attributable to you.
		</p>

		<h2>15. Changes to these Terms</h2>
		<p>
			We may change these Terms, in accordance with Article 548-4 of the Civil Code of Japan, when the change is in the
			general interest of users, or when it does not conflict with the purpose of the agreement and is reasonable in
			light of the need for the change, the appropriateness of its content and other circumstances.
		</p>
		<p>
			Before a change takes effect, we will announce on the website that the Terms are changing, the content of the
			updated Terms and the date they take effect, and we may also notify you by email. For changes that are unfavorable
			to users, such as new fees or stricter limits, we will make this announcement at least 14 days before the
			effective date. Changes that only benefit users, or that are urgently required by law, may take effect sooner.
		</p>
		<p>
			The updated Terms apply from their effective date. If you do not agree with a change, stop using the Service and
			delete your account before that date.
		</p>

		<h2>16. Governing law and jurisdiction</h2>
		<p>
			These Terms are governed by the laws of Japan. The Tokyo District Court has exclusive jurisdiction as the court of
			first instance over any dispute arising from or related to the Service or these Terms.
		</p>

		<h2>17. General</h2>
		<ul>
			<li>
				If any provision of these Terms is found unenforceable, the rest of the Terms remain in effect, and that
				provision is enforced to the maximum extent permitted.
			</li>
			<li>Our not enforcing a provision is not a waiver of our right to enforce it later.</li>
			<li>
				You may not transfer your rights or obligations under these Terms without our consent. We may transfer ours in
				connection with a transfer of the Service.
			</li>
			<li>These Terms and the Privacy Policy are the entire agreement between you and us regarding the Service.</li>
		</ul>

		<h2>18. Contact</h2>
		<p>Questions about these Terms can be sent to support@webforai.dev.</p>
	</article>
);
