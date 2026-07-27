interface FAQ {
  q: string;
  a: string;
}

interface HiddenFAQProps {
  faqs: FAQ[];
}

/**
 * Hidden FAQ component that outputs both JSON-LD structured data (for Google/SEO)
 * and visually hidden DOM content (for embedding crawlers and Pagefind search).
 *
 * The content is hidden from users but available for:
 * - Google rich snippets via JSON-LD
 * - Site search via Pagefind indexing
 * - Embedding models that crawl page content
 */
export function HiddenFAQ({ faqs }: HiddenFAQProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.a
      }
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section
        className="hidden-faq"
        aria-hidden="true"
        data-pagefind-weight="0.5"
      >
        <h2>Frequently Asked Questions</h2>
        {faqs.map((faq, i) => (
          <div key={i}>
            <h3>{faq.q}</h3>
            <p>{faq.a}</p>
          </div>
        ))}
      </section>
    </>
  );
}
