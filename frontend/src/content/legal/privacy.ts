export const PRIVACY = `# Privacy Policy

**Last updated:** {{LAST_UPDATED}}

This Privacy Policy explains how {{OPERATOR_NAME}} ("**we**", "**us**" or "**our**") collects, uses, and shares personal information when you use Vettan (the "**Service**"). We are responsible for this information as its data controller.

Vettan is a free, non-commercial demonstration project run by one person. We collect only what the Service needs to work, and we try to describe that precisely here.

## Key points

- We collect your **name and email address**, the **questions you ask**, the **answers you receive**, and limited **technical and usage data**.
- To answer a question, we send it to **OpenAI** (AI models) and send search terms derived from it to **Tavily** (web search). OpenAI doesn't train on data sent through its API and keeps it for up to 30 days for abuse monitoring. Tavily handles search terms under its own privacy policy.
- We **don't sell** your information, **don't show ads**, **don't use analytics or advertising cookies**, and **don't train AI models** on your content.
- You can **delete any conversation, or your whole account, yourself** from the app. Deleting your account erases your history immediately.
- Vettan is for people aged **{{MIN_AGE}} and over**.

## 1. Scope

This policy applies to the Vettan website and app, including the landing page, sign-up and sign-in, the research assistant, conversation history, and text-to-speech.

It does not cover the third-party websites that answers cite or link to. Those sites have their own privacy policies.

## 2. Information we collect

### Information you give us

- **Account information.** Your name, email address, and password when you sign up. Passwords are handled by our authentication provider, Supabase, which stores them only in hashed form. We never see your password.
- **Questions and conversations.** The questions you ask and follow-ups you send, plus the conversation titles and favorites you set.
- **Text for audio.** The text you ask us to read aloud.
- **Messages to us.** If you email us, the contents of your message and your email address.

### Information created when you use the Service

- **Answers.** The reports and answers generated for you, with the sources cited (titles and website addresses).
- **Usage records.** For each day you use the Service: how many research questions, follow-ups, and audio characters you used, and an estimate of the cost. We use these to enforce daily limits.
- **Moderation results.** When our automated screening flags content, our server logs record the category of the flag (for example, "violence") and a shortened account identifier. We never log the flagged text. Some categories, such as self-harm, can reveal sensitive information, so these records are kept only as long as our server logs and used only to operate and protect the Service.
- **Audio.** Audio is generated when you ask for it and sent straight to your browser. **We do not store audio files.**

### Information collected automatically

- **Log data.** Like most web services, our servers and hosting providers keep logs to run the Service and fix problems. These logs can include your IP address, browser type, the time and address of each request, and your account ID. **Our server logs may also include excerpts of your activity**: up to the first 100 characters of a question, the search terms generated from it, and conversation titles. They are kept for a short period (see [Retention](#7-how-long-we-keep-information)).
- **Authentication events.** Supabase records sign-in, sign-up, and password-reset events, including the IP address and time, for security.
- **Cookies and browser storage.** See [Cookies and browser storage](#9-cookies-and-browser-storage).

We do not collect payment information, precise location, contacts, or information from social networks. We do not buy information about you from others.

## 3. How we use information

We use personal information to:

- **Provide the Service.** Create and secure your account, answer your questions, keep your conversation history so you can return to it and ask follow-ups, and generate audio.
- **Reuse your own earlier answers.** If you ask a question you've asked before, we may show your saved answer instead of researching it again. Saved answers are only ever reused for the account that created them.
- **Enforce limits and prevent abuse.** Apply rate limits and daily usage limits, detect automated or abusive use, and keep costs under control.
- **Keep the Service safe.** Screen questions, answers, and audio text for violations of our [Usage Policy](/usage-policy).
- **Maintain and improve reliability.** Diagnose errors, monitor performance, and fix bugs.
- **Communicate with you.** Send emails needed for your account, such as sign-up confirmation and password resets, and reply when you contact us. We don't send marketing emails.
- **Meet legal obligations** and protect our rights and the rights and safety of others.

**What we don't do:**

- We **don't sell or rent** personal information, and we don't "share" it for cross-context behavioral advertising.
- We **don't use your content to train AI models**, and OpenAI doesn't use API data for training. Tavily receives only search terms, never your account details, and may use them to improve its search service under its own privacy policy.
- We **don't use your information for advertising** or build advertising profiles.

### Legal bases (for users in the EEA, UK, and similar jurisdictions)

| Purpose | Legal basis |
|---|---|
| Providing your account, answers, history, and audio | Performance of our contract with you (the [Terms](/terms)) |
| Rate limits, usage limits, abuse prevention, content screening, security, and debugging | Our legitimate interests in keeping the Service safe, available, and affordable to run |
| Account emails and replies to your messages | Performance of our contract, and our legitimate interests |
| Complying with the law and responding to lawful requests | Legal obligation |

## 4. How AI and search providers process your content

Answering a question requires sending some of your content to third-party providers. Here is exactly what is sent:

- **OpenAI** receives your question; for follow-ups, recent messages from the same conversation; and excerpts from the web pages selected as sources. It uses them to plan searches and write the answer. OpenAI also receives your questions, generated answers, and audio text for **automated content screening**, and the text you ask to hear for **text-to-speech**.
- **Tavily** receives the **search terms** we generate from your question (or, if that step fails, the question itself) and returns web search results. It does not receive your email address or account details.

Under OpenAI's API data policy, data sent through the API **is not used to train OpenAI's models**, and OpenAI may keep it for **up to 30 days** to monitor for abuse, unless the law requires longer. Tavily processes search terms under [its privacy policy](https://tavily.com/privacy) and may use them to improve its search service. Tavily never receives your email address or account details, so it can't link search terms to your Vettan account. Even so, avoid putting personal information in your questions. We do not send your email address or name to OpenAI or Tavily.

## 5. Service providers

We use the following providers to run the Service. They process personal information on our behalf and only for the purposes described here.

| Provider | What it does for us | Information involved | Location |
|---|---|---|---|
| [Supabase](https://supabase.com/privacy) | Database, user accounts, authentication emails | Name, email, conversations, usage records, authentication events | United States or another region selected for our account |
| [Render](https://render.com/privacy) | Hosts the backend that runs research | Requests, log data | United States or another region selected for our account |
| [Vercel](https://vercel.com/legal/privacy-policy) | Hosts the website | Requests, log data | Global edge network |
| [OpenAI](https://openai.com/policies/privacy-policy) | AI models, content screening, text-to-speech | Questions, conversation context, source excerpts, answers, audio text | United States |
| [Tavily](https://tavily.com/privacy) | Web search | Search terms derived from your questions | United States |

## 6. When we share information

We share personal information only:

- **With the service providers** listed above, to run the Service;
- **When the law requires it**, for example in response to a valid legal process, and only to the extent required;
- **To protect people and the Service**: to prevent fraud or abuse, protect the safety of any person, or enforce our [Terms](/terms);
- **If the project changes hands**: if Vettan is transferred to someone else, your information may move with it, and this policy (or one at least as protective) will continue to apply. We will tell you before that happens;
- **With your consent** or at your direction.

## 7. How long we keep information

| Information | How long we keep it |
|---|---|
| Account information | Until you delete your account |
| Conversations and answers | Until you delete the conversation or your account. Deletion removes them from our database immediately |
| Daily usage records | While your account exists. Deleted with your account |
| Aggregate daily totals (not linked to any person) | Indefinitely, to manage the Service's costs |
| Server logs | About {{LOG_RETENTION_DAYS}} days, after which our hosting provider deletes them |
| Database backups | If our database provider keeps backups, deleted data can remain in them for up to 7 days before they are overwritten |
| Data held by OpenAI for abuse monitoring | Up to 30 days, under OpenAI's API data policy |
| Emails you send us | As long as needed to deal with your request, then deleted |

If the Service shuts down, we will delete personal information after the notice period described in the [Terms](/terms#12-availability-and-discontinuation). We may keep information for longer only if the law requires it, or to resolve a dispute or deal with abuse.

## 8. Your rights and choices

### Things you can do yourself, at any time

- **See your data.** Your conversation history is available in the app.
- **Correct your details.** Change your name or email address in **Settings**.
- **Edit or delete a conversation.** Rename, favorite, or delete any conversation from the sidebar.
- **Delete your account.** Go to **Settings → Delete account**. This permanently erases your account, conversations, and usage records straight away.

### Rights you can exercise by contacting us

Depending on where you live (for example, under the GDPR in the EEA, the UK GDPR, the California Consumer Privacy Act, or India's Digital Personal Data Protection Act), you may have the right to:

- **access** the personal information we hold about you and receive a copy, including in a portable format;
- **correct** information that is inaccurate;
- **delete** your information;
- **object to** or **restrict** certain processing, including processing based on our legitimate interests;
- **withdraw consent**, where we rely on it;
- **not be treated differently** for exercising your rights; and
- **appoint someone** to act on your behalf, where the law allows.

To make a request, email {{CONTACT_EMAIL}} from the address linked to your account. We may need to confirm your identity first. We will respond within one month, or sooner if the law requires.

**Automated decisions.** Our content screening decides automatically whether a request can be answered. It has no legal or similarly significant effect on you, but if you think a decision was wrong, you can contact us and we will review it.

**Complaints.** If you are unhappy with how we handle your information, please contact us first so we can try to fix it. You also have the right to complain to the data protection authority where you live or work.

## 9. Cookies and browser storage

We use only the storage the Service needs to work. **We don't use analytics, advertising, or cross-site tracking cookies**, so we don't show a cookie consent banner.

| Name | Type | Purpose | Duration |
|---|---|---|---|
| \`sb-…-auth-token\` | Cookie (strictly necessary) | Keeps you signed in securely | Until you sign out, or up to 400 days |
| \`sb-…-auth-token-code-verifier\` | Cookie (strictly necessary) | Completes sign-up confirmation and password-reset links securely | Until the link is used |
| \`sidebarExpanded\` | Local storage (functional) | Remembers whether the sidebar is open | Until you clear your browser storage |

Our website fonts are served from our own domain, so loading a page does not send your information to a font provider.

## 10. Security

We take reasonable technical and organizational measures to protect personal information, including:

- encrypting all connections to the Service with HTTPS (TLS);
- enforcing access controls in the database so that each account can only read its own conversations, and testing that isolation automatically;
- relying on Supabase to store passwords only in hashed form;
- limiting access to production systems and keys to the operator.

No online service can be completely secure. Please use a unique password, and don't put sensitive personal information (such as health, financial, or identity details) into your questions. If we become aware of a breach that affects your personal information, we will notify you and the relevant authorities where the law requires.

## 11. International transfers

We and our providers may process personal information in countries other than the one where you live, including the United States. These countries may have different data protection laws from yours. We use well-established providers that publish their own privacy and security commitments, linked in [Service providers](#5-service-providers).

## 12. Children

Vettan is not intended for anyone under {{MIN_AGE}}, and we do not knowingly collect personal information from them. If you believe someone under {{MIN_AGE}} has created an account, contact us at {{CONTACT_EMAIL}} and we will delete it.

## 13. Changes to this policy

We may update this policy as the Service or the law changes. When we do, we will update the "Last updated" date above. If the changes are material, for example a new type of data or a new provider that receives your content, we will tell you in advance by email or in the Service.

## 14. Contact

For questions about this policy or your personal information, contact {{OPERATOR_NAME}} at {{CONTACT_EMAIL}}.
`
