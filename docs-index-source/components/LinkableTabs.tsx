import { Tabs as NextraTabs } from 'nextra/components'
import type { ComponentProps } from 'react'
import { LinkableTabs } from './LinkableTabs.client'

/**
 * Nextra's `Tabs`, with the open tab chosen by a `?tab=` query parameter.
 *
 * Nextra supports `defaultIndex` and a `storageKey`, but nothing that reads the URL, so a link
 * into a page with tabs could only ever land on whichever tab happens to be first. That makes a
 * cross-reference to one tab's content impossible to write: every link goes to the same place and
 * shows the same tab. Linking to `?tab=claude-code#configure-forwarding-to-grepr` opens the Claude
 * Code tab, and the fragment scrolls to the section heading as usual.
 *
 * A query parameter rather than the fragment, deliberately: the fragment has to stay free for the
 * real heading anchor. Nextra's own heading anchors scroll reliably and survive in the address bar,
 * whereas a synthetic in-page anchor for each tab did neither — a hidden anchor is not a valid
 * scroll target, and the fragment was being rewritten during hydration.
 *
 * Use this in place of `nextra/components`' `Tabs`. Two things matter when editing it:
 *
 * - The element stays named `Tabs` in MDX. The docs-extract pipeline that builds the in-product
 *   Agent Setup Guide matches on the JSX element name, so renaming it would silently drop a page's
 *   collectors from the guide.
 * - `Tab` is attached here, in a server module, and the URL logic lives in
 *   `LinkableTabs.client.tsx`. Static properties on a `'use client'` export do not survive the
 *   server/client boundary — Next replaces the export with a module reference and `Tabs.Tab` comes
 *   back undefined, failing the MDX render with "Expected component `Tabs.Tab` to be defined".
 *   This mirrors how Nextra itself composes the two halves.
 */
export const Tabs = Object.assign(
  (props: ComponentProps<typeof NextraTabs>) => <LinkableTabs {...props} />,
  { Tab: NextraTabs.Tab }
)
