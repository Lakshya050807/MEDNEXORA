import Icon from '../components/Icon.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import SiteHeader from '../components/SiteHeader.jsx';

const informationPages = {
  about: {
    eyebrow: 'OWNER CONFIRMATION REQUIRED',
    title: 'About MEDNEXORA',
    summary: 'The owner launch checklist does not yet include the business and service answers needed to finalize this page.',
    notice: 'This page is not finalized. Confirm the legal operator and brand relationship, accurate service and audience description, and any claims or affiliations before publication.',
    sections: [
      { title: 'Business and brand identity', body: 'Owner confirmation required: provide the full legal identity of the service operator and explain how MEDNEXORA relates to that person or entity.' },
      { title: 'Service and intended audience', body: 'Owner confirmation required: describe the services currently offered, intended learners, and geographic availability. Include qualifications, affiliations, or content-review claims only with confirmed wording and supporting evidence.' },
      { title: 'Educational information', body: 'Owner confirmation required: explain how examination information is sourced and maintained, how corrections are handled, and what limitations should be stated.' },
    ],
  },
  contact: {
    eyebrow: 'OWNER CONFIRMATION REQUIRED',
    title: 'How can we help?',
    summary: 'The owner launch checklist does not contain a confirmed support contact or public business address.',
    notice: 'Do not use this page as a support channel until the owner provides a monitored contact method.',
    sections: [
      { title: 'Student support', body: 'Owner confirmation required: provide a monitored support email or other contact method, identify which enquiries it handles, and confirm support hours or response expectations only if these will be published.' },
      { title: 'Business correspondence', body: 'Owner confirmation required: provide a business or correspondence address only if applicable and approved for public display. Confirm the type of address.' },
    ],
  },
  faq: {
    eyebrow: 'OWNER CONFIRMATION REQUIRED',
    title: 'Frequently asked questions.',
    summary: 'Answers are awaiting owner confirmation so this page accurately reflects the service, its policies, and current operation.',
    notice: 'The checklist contains topics to answer, but no approved answers. Do not treat the prompts below as service terms.',
    faqs: [
      { question: 'What do I need to register, and what student information is collected?', answer: 'Owner confirmation required: provide the actual registration requirements and information collected, including whether learning, technical, device, cookie, or analytics data is collected.' },
      { question: 'How do purchases, previews, downloads, and access work?', answer: 'Owner confirmation required: describe the available digital products, configured previews, access duration and restrictions, order status meanings, and supported devices or technical requirements.' },
      { question: 'What are the refund and cancellation rules?', answer: 'Owner confirmation required: approve eligibility, exclusions, request steps, cancellation rules, and accurate review and payment-processing timelines. See the Refund and Cancellation page after it is approved.' },
      { question: 'How can I contact support or request account help?', answer: 'Owner confirmation required: provide the monitored support channel and the process for account, privacy, order, access, and refund enquiries.' },
      { question: 'How is examination information maintained?', answer: 'Owner confirmation required: describe the sources, update process, correction route, and any verified affiliation or limitation. Do not imply official endorsement without evidence.' },
    ],
  },
  privacy: {
    eyebrow: 'POLICY DRAFT',
    title: 'Privacy policy',
    summary: 'This page needs owner review and accurate service details before public launch.',
    notice: 'Draft placeholder — confirm the actual data practices and have this policy reviewed before publishing.',
    sections: [
      { title: 'Information collected', body: '[Describe the account, learning, order, device and analytics data the live service actually collects.]' },
      { title: 'How information is used and shared', body: '[Describe service purposes, processors, payment-provider data handling and any other sharing that applies.]' },
      { title: 'Retention and user requests', body: '[Describe retention periods and the process for access, correction or deletion requests.]' },
      { title: 'Contact and effective date', body: '[Add the confirmed privacy contact and effective date.]' },
    ],
  },
  terms: {
    eyebrow: 'POLICY DRAFT',
    title: 'Terms and conditions',
    summary: 'This page needs approved terms that match the final MEDNEXORA service and sales process.',
    notice: 'Draft placeholder — add the owner-approved terms and obtain appropriate review before public launch.',
    sections: [
      { title: 'Service and accounts', body: '[Describe the service, account requirements and account responsibilities.]' },
      { title: 'Digital resources and access', body: '[Describe accurate purchase, free-resource, preview, download and access terms.]' },
      { title: 'Acceptable use and service changes', body: '[Add the approved usage rules, content permissions and service-change terms.]' },
      { title: 'Contact and effective date', body: '[Add the confirmed business contact and effective date.]' },
    ],
  },
  refunds: {
    eyebrow: 'POLICY DRAFT',
    title: 'Refund and cancellation policy',
    summary: 'The refund and cancellation terms are awaiting owner confirmation.',
    notice: 'Draft placeholder — no refund period, eligibility rule or promise is stated here. Add the approved policy and review it before accepting public purchases.',
    sections: [
      { title: 'Refund eligibility', body: '[Insert the owner-approved refund eligibility rules and any applicable exceptions.]' },
      { title: 'Cancellation process', body: '[Explain how a student can request cancellation and what information is needed.]' },
      { title: 'Processing and support', body: '[Describe the confirmed handling process, expected communication and support contact. Do not add an unverified timeframe.]' },
    ],
  },
};

export default function InformationPage({ page = 'about' }) {
  const content = informationPages[page] ?? informationPages.about;
  const needsOwnerConfirmation = ['about', 'contact', 'faq', 'privacy', 'terms', 'refunds'].includes(page);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="information-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
            <a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">{content.title}</span>
          </nav>
          <header className="information-hero">
            <p className="eyebrow">{content.eyebrow}</p>
            <h1>{content.title}</h1>
            <p>{content.summary}</p>
          </header>
          {content.notice && <aside className={`information-notice${needsOwnerConfirmation ? ' is-draft' : ''}`} role="note"><Icon name={needsOwnerConfirmation ? 'file' : 'shield'} size={19} /><p>{content.notice}</p></aside>}
          {content.faqs ? (
            <section className="information-faq-list" aria-label="Frequently asked questions">
              {content.faqs.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}
            </section>
          ) : (
            <div className="information-section-list">
              {content.sections.map((section) => <section className="information-section" key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
