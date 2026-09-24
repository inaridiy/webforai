export const PrivacyContent = ({ className }: { className?: string }) => (
	<article className={className}>
		<h1>Privacy Policy</h1>
		<p>Effective: 2026-09-24</p>

		<h2>1. Who we are</h2>
		<p>
			webforai platform at https://platform.webforai.dev (the “Service”) is a hosted API that fetches web pages and
			converts them to Markdown. It is operated by an individual developer based in Japan (“we”, “us”). This policy
			explains what information we collect when you use the Service, why, and how it is handled.
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
				<strong>API keys.</strong> Keys you create and information about their use.
			</li>
			<li>
				<strong>Usage and billing information.</strong> Your jobs and the credits they use, your usage history, and
				billing records such as your Stripe customer and subscription status. Payments are processed by Stripe. We never
				see or store your card number.
			</li>
			<li>
				<strong>Job contents.</strong> The URLs and options you submit, and the results produced for you, including
				converted Markdown, screenshots and re-hosted images.
			</li>
			<li>
				<strong>Request logs.</strong> Request metadata such as IP address, user agent, timestamps and requested URLs.
			</li>
		</ul>

		<h2>3. How we use information</h2>
		<ul>
			<li>to provide the Service, run your jobs and deliver results to you;</li>
			<li>to sign you in and send you sign-in codes;</li>
			<li>to meter usage, apply the free monthly credits and bill paid usage;</li>
			<li>to keep the Service secure, prevent abuse and enforce rate limits;</li>
			<li>to investigate and fix problems with the Service;</li>
			<li>to respond to your requests and to comply with legal obligations.</li>
		</ul>
		<p>
			We do not look into the contents of your jobs, except as needed to operate, secure or debug the Service, or when
			required by law. We send email only for sign-in codes. We do not send marketing email. We do not sell your
			personal information.
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
				rendering and screenshots (Browser Rendering), and delivery of sign-in emails (Email Sending).
			</li>
			<li>
				<strong>Stripe</strong>: payment processing and billing.
			</li>
			<li>
				<strong>A rotating proxy provider</strong>: when a job uses a proxy engine, requests to the target site are
				routed through this provider, which handles the requested URLs and the fetched traffic.
			</li>
			<li>
				<strong>GitHub</strong>: only if you choose to sign in with or link GitHub.
			</li>
		</ul>
		<p>
			These providers may process information in countries outside Japan, including the United States. We may also
			disclose information when required by law, or when reasonably necessary to protect the Service, our users or
			others from fraud, abuse or security threats.
		</p>

		<h2>6. Cookies</h2>
		<p>
			We use cookies to keep you signed in to the dashboard and to operate the Service securely. We do not use
			advertising cookies.
		</p>

		<h2>7. Retention</h2>
		<ul>
			<li>Job results, screenshots and re-hosted images are kept for up to 7 days and then deleted automatically.</li>
			<li>Results of the public demo may be cached for up to 10 minutes.</li>
			<li>Account information, API keys and usage history are kept until your account is deleted.</li>
			<li>Request logs are kept for as long as needed for security, abuse prevention, rate limiting and billing.</li>
			<li>
				Billing records held by Stripe, and records we are required to keep by law, are retained for as long as
				required.
			</li>
		</ul>

		<h2>8. Your choices and rights</h2>
		<ul>
			<li>
				You can delete your account at any time from the dashboard. This deletes your account, API keys, jobs and usage
				history. Billing records held by Stripe and records we must keep by law are retained as required.
			</li>
			<li>
				You can ask us for access to, correction of, or deletion of your personal information, or ask us to stop using
				it, by contacting support@webforai.dev. We will respond as required by applicable law, including the Act on the
				Protection of Personal Information of Japan.
			</li>
		</ul>

		<h2>9. Security</h2>
		<p>
			We take reasonable measures to protect the information we handle. No method of transmission or storage is
			completely secure, and we cannot guarantee absolute security.
		</p>

		<h2>10. Changes to this policy</h2>
		<p>
			We may update this policy by posting a new version on the website with a new effective date. The updated policy
			takes effect when posted.
		</p>

		<h2>11. Contact</h2>
		<p>Questions or requests about this policy can be sent to support@webforai.dev.</p>
	</article>
);
