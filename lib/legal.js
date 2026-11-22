'use strict';
// Built-in legal texts. They are a sensible starting point for a staff tool, not legal advice:
// each studio should read them, adjust them and have them checked before going live.
// Replace any of them from Settings > Branding > Legal, or "legal" in studio.config.json.
//
// Placeholders: {studio} = studio name, {contact} = contact email (or "studio leadership").

const UPDATED = 'November 2026';

const TERMS = `Last updated: ${UPDATED}

1. About these terms
These Terms of Service apply to everyone who signs in to the {studio} staff panel ("the Panel"), including staff, contractors and contributors. By signing in you agree to them. If you don't agree, don't use the Panel.

2. Your account
You sign in with an account you own (for example Roblox or Google). Keep that account secure and don't share it or your session with anyone. {studio} can grant, change or remove your access at any time, for example when your role changes or you leave the team.

3. What the Panel is for
The Panel is an internal tool for logging work, reviewing and approving payment requests, tracking payouts, and organising teams, tasks and access. It is not a public product. It is not affiliated with or endorsed by Roblox Corporation, Google or any other sign-in provider.

4. Accurate information
Anything you submit, including work logs, payment requests and payout details, must be accurate and describe work you actually did. False, inflated or duplicate entries may be rejected and can lead to loss of access.

5. Payments
Rates, currencies and conversion rates shown in the Panel are set by {studio} and may change. Submitting a request does not guarantee payment: requests are reviewed and approved at {studio}'s discretion and under any agreement you have with {studio}. You are responsible for keeping your payout details correct. {studio} is not responsible for a payout sent to details you entered incorrectly.

6. Availability
The Panel is provided "as is". {studio} works to keep it available and your data accurate, but does not promise it will always be available or free of errors.

7. Ending access
You can stop using the Panel at any time. {studio} may suspend or end your access if you break these terms or the Acceptable Use Policy, or when you are no longer working with {studio}. Records of work and payments may be kept as described in the Privacy Policy.

8. Changes
These terms may be updated. When they change materially, you may be asked to accept them again. Continuing to use the Panel after an update means you accept the new version.

9. Contact
Questions about these terms: {contact}.`;

const PRIVACY = `Last updated: ${UPDATED}

This Privacy Policy explains what the {studio} staff panel ("the Panel") collects about you, why, and what you can do about it.

1. What we collect
- Sign-in details: your account id and display name from the provider you sign in with (for example your Roblox user id and username, or your Google name and email address), and your profile picture.
- Work and payment records: work logs, payment requests, approvals, amounts and payout history.
- Payout details you choose to save, such as a PayPal email, a Venmo username, a Roblox username for Robux payouts, or bank transfer details.
- Team information: your teams, skills, roles, tasks and any warnings or notes added by staff.
- Security data: when you signed in, the browser you used, and a record of important actions (the audit log).

2. Why we use it
We use this information to let you sign in, decide what you can see and do, pay you, keep accurate financial records, run teams and projects, and protect the Panel and the people who use it from fraud and misuse.

3. Who can see it
Only people at {studio} whose role needs it. Bank details are limited to roles with explicit permission to see them. We do not sell your information. We share it only with the services the Panel runs on (hosting and database providers), with payment providers when we pay you, or where the law requires it.

4. Where it is stored
Data is stored in the Panel's database, which is not reachable from the public internet without going through the Panel's own checks. Sessions are stored only as one-way hashes, and connections are encrypted.

5. How long we keep it
Payment and work records are kept for as long as {studio} needs them for accounting and legal reasons. Sign-in sessions expire after a period of inactivity. You can ask for your other information to be removed when you stop working with {studio}.

6. Your choices
You can view your own payment history and payout details in the Panel at any time, and update or remove your payout details yourself. To ask for a copy of your data, a correction or deletion, contact {contact}.

7. Cookies and local storage
The Panel stores your session and display preferences (such as dark mode) in your browser. It does not use advertising or tracking cookies.

8. Changes
If this policy changes, the updated version will be posted here with a new date.

9. Contact
Privacy questions or requests: {contact}.`;

const AUP = `Last updated: ${UPDATED}

This Acceptable Use Policy explains what is and isn't okay in the {studio} staff panel ("the Panel"). It applies to everyone with access, whatever their role.

1. Use it for its purpose
Only log work you actually did. Only use the access and permissions you were given, and only for the reason you were given them.

2. Don't misuse access
Don't try to see or change data or settings you haven't been given access to. Don't share your account or session. Don't try to bypass, disable or trick the Panel's permission, approval or security checks.

3. Money
Don't submit duplicate, inflated or fraudulent requests. Don't approve, re-price or pay out your own requests, or use elevated access for your own benefit. Financial permissions are for processing the team's requests, not your own.

4. Confidential information
Payment history, payout details, staff records and anything else in the Panel are confidential to {studio}. Don't export, screenshot or share them outside {studio} without permission.

5. Respect other people
Treat everyone you deal with through the Panel with respect. Harassment, discrimination and abuse are not tolerated.

6. Honest access
Don't try to gain access under false pretences, for example by using a second account to get around a restriction on your main one.

7. Consequences
Breaking this policy can lead to rejected or reversed payments, removed permissions, warnings, suspension or permanent loss of access, depending on how serious it is.

8. Reporting
If you see something that looks wrong, report it to {contact}.`;

module.exports = { TERMS, PRIVACY, AUP, UPDATED };
