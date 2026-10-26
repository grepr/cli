/**
 * Lightweight React stub components for server-side rendering of MDX files.
 *
 * These stubs replace Nextra/custom components during SSR so that
 * `renderToStaticMarkup` produces clean, semantic HTML that can be
 * converted to Markdown for the vector search index.
 *
 * Each stub outputs only the visible, indexable content — no
 * interactive behaviour, no styling classes.
 */

import React, { type ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  nextra/components — Callout                                       */
/* ------------------------------------------------------------------ */

interface CalloutProps {
  children?: ReactNode;
  type?: string;
  emoji?: string;
}

export function Callout({ children }: CalloutProps): React.ReactElement {
  return React.createElement('blockquote', null, children);
}

/* ------------------------------------------------------------------ */
/*  nextra/components — Tabs / Tabs.Tab                               */
/* ------------------------------------------------------------------ */

interface TabsProps {
  children?: ReactNode;
  items?: string[];
}

interface TabProps {
  children?: ReactNode;
}

function Tab({ children }: TabProps): React.ReactElement {
  return React.createElement('div', null, children);
}

function TabsComponent({ children }: TabsProps): React.ReactElement {
  return React.createElement('div', null, children);
}

TabsComponent.Tab = Tab;

export const Tabs = TabsComponent;

/* ------------------------------------------------------------------ */
/*  nextra/components — Cards / Cards.Card                            */
/* ------------------------------------------------------------------ */

interface CardProps {
  title?: string;
  href?: string;
  children?: ReactNode;
}

function Card({ title, href, children }: CardProps): React.ReactElement {
  if (title && href) {
    return React.createElement(
      'p',
      null,
      React.createElement('a', { href }, title)
    );
  }
  return React.createElement('p', null, children);
}

interface CardsProps {
  children?: ReactNode;
}

function CardsComponent({ children }: CardsProps): React.ReactElement {
  return React.createElement('div', null, children);
}

CardsComponent.Card = Card;

export const Cards = CardsComponent;

/* ------------------------------------------------------------------ */
/*  @/components/HiddenFAQ                                            */
/* ------------------------------------------------------------------ */

interface FAQ {
  q: string;
  a: string;
}

interface HiddenFAQProps {
  faqs: FAQ[];
}

/**
 * Renders FAQ content as visible HTML so it gets indexed.
 * Uses h4 for questions to avoid clashing with the page's heading hierarchy.
 */
export function HiddenFAQ({ faqs }: HiddenFAQProps): React.ReactElement {
  return React.createElement(
    'section',
    null,
    ...faqs.map((faq, i) =>
      React.createElement(
        React.Fragment,
        { key: i },
        React.createElement('h4', null, `Q: ${faq.q}`),
        React.createElement('p', null, `A: ${faq.a}`)
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/*  ./ApiSpecPage — client-only Redoc; returns null for SSR           */
/* ------------------------------------------------------------------ */

export function ApiSpecPage(): null {
  return null;
}
