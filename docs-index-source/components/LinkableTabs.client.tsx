'use client'

import { Tabs as NextraTabs } from 'nextra/components'
import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react'

type TabItem = string | ReactElement
type TabObjectItem = { label: TabItem; disabled: boolean }

/** Query parameter that names the tab to open. */
const TAB_PARAM = 'tab'

/**
 * Slug for one tab label, matching `slugify` in
 * `frontend/scripts/docs-extract/extract.mjs` so a tab's link value is the same string as the
 * collector id the extractor generates for it. "Claude Code" becomes `claude-code`.
 */
function tabSlug(item: TabItem | TabObjectItem): string | null {
  const label =
    typeof item === 'object' && item && 'label' in item ? item.label : item
  if (typeof label !== 'string') return null
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || null
}

/**
 * Nextra's `Tabs` with the open tab chosen by the `?tab=` query parameter. See `LinkableTabs.tsx`
 * for why this exists and why the server wrapper there is a separate file.
 *
 * The parameter is read once per mount. That covers a link from another page, which is the case
 * this exists for; it would not re-select on a soft navigation that changes only `?tab=` on the
 * page already open.
 */
export function LinkableTabs({
  items,
  children,
  ...rest
}: ComponentProps<typeof NextraTabs>) {
  // Indexed positionally against `items`: a label that is an element rather than a string has no
  // slug, and dropping those would shift every later index and open the wrong tab.
  const slugs = (items as (TabItem | TabObjectItem)[]).map(
    (item) => tabSlug(item) ?? ''
  )
  const slugKey = slugs.join('\n')
  // Undefined until the parameter names one of this group's tabs, so an ordinary visit keeps
  // Nextra's own behavior — `defaultIndex`, or the tab persisted under `storageKey` — rather than
  // being forced to the first tab. A page can hold several tab groups, and a `?tab=` meant for one
  // of them must leave the others alone.
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(
    undefined
  )

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(TAB_PARAM)
    if (!requested) return
    const index = slugKey.split('\n').indexOf(requested)
    if (index >= 0) setSelectedIndex(index)
  }, [slugKey])

  return (
    <NextraTabs
      items={items}
      selectedIndex={selectedIndex}
      onChange={setSelectedIndex}
      {...rest}
    >
      {children}
    </NextraTabs>
  )
}
