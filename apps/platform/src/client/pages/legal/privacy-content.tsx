export const PrivacyContent = ({ className }: { className?: string }) => (
	<article className={className}>
		<h1>Privacy Policy</h1>
		<p>Effective: 2026-10-01</p>

		<h2>1. Who we are</h2>
		<p>
			webforai platform at https://platform.webforai.dev (the “Service”) is a hosted API that fetches web pages and
			converts them to Markdown. It is operated by 稲垣凛太郎 (trade name: 稲荷屋), an individual business operator in
			Japan (“we”, “us”), who is responsible for handling personal information in the Service. Our address is disclosed
			without delay on request to support@webforai.dev. This policy explains what information we collect when you use
			the Service, why, and how it is handled.
		</p>

		<h2>2. Information we collect</h2>
		<ul>
			<li>
				<strong>Account information.</strong> Your email address. If you sign in with or link GitHub, your GitHub
				account identifier and the basic profile information GitHub provides on sign-in, such as your email address.
			</li>
			<li>
				<strong>Sign-in information.</strong> One-time sign-in codes sent to your email, and session information that
				keeps you signed in.
			</li>
			<li>
				<strong>Bot-check information.</strong> When the sign-in form shows Cloudflare Turnstile, Cloudflare processes
				your IP address and signals from your browser and device to tell people from automated traffic. We receive only
				the result of the check.
			</li>
			<li>
				<strong>API keys.</strong> Keys you create and information about their use.
			</li>
			<li>
				<strong>Usage and billing information.</strong> Your jobs and the credits they use, your usage history, your
				monthly spend cap, and billing records such as your Stripe customer and subscription status. Payments are
				processed by Stripe. We never see or store your card number.
			</li>
			<li>
				<strong>Job contents.</strong> The URLs and options you submit, and the results produced for you, including
				converted Markdown, screenshots and re-hosted images. For batch and crawl jobs, the request (including its
				target URLs and options) is stored with the job record in our database (Cloudflare D1). For single scrape
				requests, our database records the engine and the credits used, not the URL.
			</li>
			<li>
				<strong>Request logs and rate limiting.</strong> Request metadata such as IP address, user agent, timestamps and
				requested paths. Your account and, for sign-in and the public demo, your IP address are used as keys for rate
				limits.
			</li>
		</ul>

		<h2>3. How we use information</h2>
		<ul>
			<li>to provide the Service, run your jobs and deliver results to you;</li>
			<li>to sign you in and send you sign-in codes;</li>
			<li>to meter usage, apply the free monthly credits and your spend cap, and bill paid usage;</li>
			<li>to keep the Service secure, prevent abuse and enforce rate limits;</li>
			<li>to investigate and fix problems with the Service;</li>
			<li>to respond to your requests and to comply with legal obligations.</li>
		</ul>
		<p>
			We do not look into the contents of your jobs, except as needed to operate, secure or debug the Service, or when
			required by law. We send email for sign-in codes and, when needed, important notices about your account or about
			changes to our Terms of Service or this policy. We do not send marketing email. We do not sell your personal
			information.
		</p>

		<h2>4. Personal information in fetched pages</h2>
		<p>
			Pages you ask the Service to fetch may contain personal information about other people. We process that content
			only to run your jobs, on your instructions. You are responsible for having a lawful basis to collect and use any
			personal information contained in the pages you fetch.
		</p>

		<h2>5. Service providers</h2>
		<p>We use the following providers to run the Service. They process information on our behalf.</p>
		<ul>
			<li>
				<strong>Cloudflare</strong>: hosting and application runtime (Workers), databases and storage (D1, KV, R2), page
				rendering and screenshots (Browser Rendering), delivery of sign-in emails (Email Sending), the sign-in bot check
				(Turnstile), rate limiting and application logs (Workers Logs).
			</li>
			<li>
				<strong>Stripe</strong>: payment processing and billing.
			</li>
			<li>
				<strong>A proxy provider</strong>: used only to fetch the target pages of requests that use a proxy engine. It
				handles the requested target URLs and the fetched traffic. We do not send it your account information or other
				personal information about you.
			</li>
			<li>
				<strong>GitHub</strong>: only if you choose to sign in with or link GitHub.
			</li>
		</ul>
		<p>
			We may also disclose information when required by law, or when reasonably necessary to protect the Service, our
			users or others from fraud, abuse or security threats.
		</p>

		<h2>6. Transfers to service providers outside Japan</h2>
		<p>
			Cloudflare and Stripe handle personal data for us outside Japan. As required by Article 28 of the Act on the
			Protection of Personal Information of Japan (APPI), this section describes where they are, the personal
			information protection system of that country, and the measures they take. By using the Service you consent to
			these transfers. In addition, both providers process personal data under data processing terms with us that
			provide protection equivalent to the APPI, and we take the measures required by Article 28(3) of the APPI to make
			sure that continues, including reviewing their terms and the relevant foreign laws. On request, we will provide
			further information about these measures.
		</p>
		<ul>
			<li>
				<strong>Cloudflare, Inc.</strong> (United States). Cloudflare operates a global network, so data may also be
				processed in its data centers in other countries, including the one nearest to you.
			</li>
			<li>
				<strong>Stripe, Inc. and its affiliates</strong> (United States).
			</li>
		</ul>
		<p>
			<strong>The personal information protection system of the United States.</strong> The United States has no
			comprehensive federal law on personal information equivalent to the APPI. Personal information is protected by
			federal laws for particular sectors and practices, such as the Federal Trade Commission Act, which prohibits
			unfair or deceptive practices including breaking published privacy promises, and by state laws, such as the
			California Consumer Privacy Act. Compared with the APPI, the rights of individuals and the duties of businesses
			differ by state and sector, and US authorities may be able to access data for law enforcement and national
			security purposes.
		</p>
		<p>
			<strong>Measures taken by the recipients.</strong> Each provider handles personal data under data processing terms
			that limit its use to providing their services to us, and that require confidentiality, security measures,
			oversight of their subcontractors, and notification of security incidents. Both maintain security programs audited
			against international standards (for example ISO/IEC 27001 and SOC 2, and PCI DSS for Stripe’s card processing).
		</p>

		<h2>7. Cookies and storage on your device</h2>
		<p>
			We use cookies to keep you signed in to the dashboard and to operate the Service securely. We do not use
			advertising cookies.
		</p>
		<p>
			The dashboard works as an installable app and keeps a copy of your dashboard data in your browser’s local storage,
			so it opens quickly and stays readable offline: your account id, email address and name, your usage, your list of
			API keys (without the secret keys), and your jobs. This copy stays on your device. It is removed when you sign
			out, when your session expires, when you delete your account, and when you choose “Clear saved data” in the
			dashboard settings. The app’s offline cache contains only the website’s own files, not your data.
		</p>

		<h2>8. Retention</h2>
		<ul>
			<li>Job results, screenshots and re-hosted images are kept for up to 7 days and then deleted automatically.</li>
			<li>Results of the public demo may be cached for up to 10 minutes.</li>
			<li>
				Batch and crawl job records, including their target URLs and options, are kept until your account is deleted.
			</li>
			<li>Account information, API keys and usage history are kept until your account is deleted.</li>
			<li>Sign-in codes expire after 10 minutes.</li>
			<li>
				Our application logs (Cloudflare Workers Logs), which may include IP addresses, user agents and requested paths,
				are deleted automatically after 7 days. Rate-limit counters are used only for the current limit window.
				Cloudflare may separately keep logs about its own services as described in Cloudflare’s privacy policy.
			</li>
			<li>
				Billing records held by Stripe, and records we are required to keep by law, are retained for as long as
				required.
			</li>
		</ul>

		<h2>9. Your choices and rights</h2>
		<ul>
			<li>
				You can delete your account at any time from the dashboard. This deletes your account, API keys, jobs and usage
				history. Billing records held by Stripe and records we must keep by law are retained as required.
			</li>
			<li>
				You can ask us to disclose, correct, add to or delete your personal information, to stop using it or providing
				it to third parties, or to disclose records of its provision to third parties, by contacting
				support@webforai.dev. We will respond as required by applicable law, including the APPI.
			</li>
		</ul>

		<h2>10. Security</h2>
		<p>
			We take reasonable measures to protect the information we handle, including: limiting access to production systems
			and provider accounts to the operator; encrypting traffic with HTTPS; storing data with providers that encrypt it
			at rest; storing API keys only in hashed form and sign-in codes only in encrypted form; never keeping secret keys
			in the dashboard’s saved data; and checking the foreign laws described in section 6. No method of transmission or
			storage is completely secure, and we cannot guarantee absolute security.
		</p>

		<h2>11. Changes to this policy</h2>
		<p>
			We may update this policy by posting a new version on the website with a new effective date. For significant
			changes, we will announce the change and its effective date on the website in advance and may also notify you by
			email.
		</p>

		<h2>12. Contact</h2>
		<p>Questions or requests about this policy can be sent to support@webforai.dev.</p>
	</article>
);
