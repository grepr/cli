import catalog from '@/generated/analytics-sql-functions.json'
import styles from './sqlFunctionReference.module.css'

/**
 * Renders the analytics SQL function catalog.
 *
 * The data comes from `docs/generated/analytics-sql-functions.json`, which
 * `AnalyticsSqlFunctionDocsTest` writes from `GreprSqlFunctionCatalog` — the
 * same catalog an analysis is validated against. That test fails when the
 * committed file no longer matches the catalog, so this page cannot drift from
 * the product. Nothing here should be hand-edited; regenerate instead.
 */

interface Parameter {
  name: string
  type: string
  optional: boolean
  repeating: boolean
}

interface Example {
  expression: string
  explanation: string
}

interface PublishedFunction {
  name: string
  category: string
  aggregate: boolean
  keywordSyntax: boolean
  minArgs: number
  maxArgs: number
  help: string
  parameters: Parameter[]
  examples: Example[]
}

/** Reading order: the ones an analysis is mostly made of come first. */
const CATEGORY_ORDER = [
  'AGGREGATE',
  'VARIANT',
  'STRING',
  'TIME',
  'MATH',
  'CONDITIONAL',
  'CONVERSION',
  'COLLECTION',
  'BITWISE',
]

const CATEGORY_TITLES: Record<string, string> = {
  AGGREGATE: 'Aggregate',
  VARIANT: 'Attributes and variants',
  STRING: 'String',
  TIME: 'Date and time',
  MATH: 'Numeric',
  CONDITIONAL: 'Conditional',
  CONVERSION: 'Type conversion',
  COLLECTION: 'Arrays and maps',
  BITWISE: 'Bitwise',
}

/**
 * The argument list as a reader types it. A function spelled with SQL keywords
 * (`CAST(x AS BIGINT)`, `CASE WHEN …`) has no comma-separated form to
 * synthesize, so its example carries that job instead.
 */
function argumentList(fn: PublishedFunction): string {
  if (fn.keywordSyntax) return 'keyword syntax — see the example'
  if (fn.parameters.length === 0) {
    // A function with no curated parameters either takes none, or takes one the
    // catalog does not name — an optional precision, say — and the example is
    // then the only honest description of it.
    return fn.maxArgs === 0 ? 'no arguments' : 'see the example'
  }
  const parts = fn.parameters.map((parameter) => {
    const spelled = `${parameter.name}: ${parameter.type}`
    if (parameter.repeating) return `${spelled}, …`
    return parameter.optional ? `[${spelled}]` : spelled
  })
  // A negative maxArgs is the catalog's way of saying variadic.
  const variadic =
    fn.maxArgs < 0 && !fn.parameters.some((parameter) => parameter.repeating)
  return `${parts.join(', ')}${variadic ? ', …' : ''}`
}

export function SqlFunctionReference() {
  const functions = catalog.functions as PublishedFunction[]
  const categories = [
    ...CATEGORY_ORDER.filter((category) =>
      functions.some((fn) => fn.category === category)
    ),
    // Anything the catalog grows that this page has not been taught to order.
    // Deduplicated by first index rather than through a Set, because the docs
    // project targets ES5 and will not iterate one.
    ...functions
      .map((fn) => fn.category)
      .filter((category, index, all) => all.indexOf(category) === index)
      .filter((category) => !CATEGORY_ORDER.includes(category))
      .sort(),
  ]

  return (
    <>
      <nav className={styles.jump} aria-label="Function categories">
        {categories.map((category) => (
          <a key={category} href={`#${category.toLowerCase()}`}>
            {CATEGORY_TITLES[category] ?? category}
          </a>
        ))}
      </nav>
      {categories.map((category) => (
        <section key={category}>
          {/* A raw heading gets none of the theme's heading styles, which the
              module supplies instead. It is not in the page's table of
              contents for the same reason; the jump list above covers that. */}
          <h2 id={category.toLowerCase()} className={styles.heading}>
            {CATEGORY_TITLES[category] ?? category}
          </h2>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Arguments</th>
                  <th>Description</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                {functions
                  .filter((fn) => fn.category === category)
                  .map((fn) => (
                    <tr key={fn.name} id={fn.name.toLowerCase()}>
                      <td>
                        <code>{fn.name}</code>
                        {/* Redundant inside the Aggregate section, so shown
                            only if the catalog ever grows an aggregate that
                            sits under another category. */}
                        {fn.aggregate && category !== 'AGGREGATE' && (
                          <span className={styles.badge}>aggregate</span>
                        )}
                      </td>
                      <td className={styles.args}>
                        <code>{argumentList(fn)}</code>
                      </td>
                      <td>{fn.help}</td>
                      <td>
                        {fn.examples.map((example) => (
                          <div
                            key={example.expression}
                            className={styles.example}
                          >
                            <code>{example.expression}</code>
                            <div className={styles.explanation}>
                              {example.explanation}
                            </div>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}
