import type { Metadata } from "next";
import { Layout, Navbar, Footer, ThemeSwitch } from "nextra-theme-docs";
import "nextra-theme-docs/style.css";
import "../styles/styles.css";
import AppLogo from "../components/AppLogo";
import Script from "next/script";
import { Head, Search } from "nextra/components";
import { Analytics } from "@vercel/analytics/next";

// Builds outside Vercel (local dev and local production builds) get the green
// "local" favicon so local docs tabs are distinguishable from docs.grepr.ai.
// Vercel sets VERCEL=1 on every build it runs.
const envIconSuffix = process.env.VERCEL ? "" : "-local";

export const metadata: Metadata = {
  title: {
    default: "Grepr Documentation",
    template: "%s - Grepr Docs",
  },
  description: "Grepr observability engine documentation",
  icons: {
    icon: [
      { url: `/favicon${envIconSuffix}.svg`, type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
};

// Build a more complete pageMap based on the production site structure
const pageMap = [
  {
    name: "index",
    route: "/",
    type: "page",
    title: "What is Grepr?",
  },
  {
    name: "grepr-platform",
    route: "/grepr-platform",
    type: "folder",
    title: "The Grepr platform",
    children: [
      {
        name: "platform-overview",
        route: "/grepr-platform",
        type: "page",
        title: "Overview of the Grepr platform",
      },
      {
        name: "data-lake",
        route: "/grepr-platform/data-lake",
        type: "page",
        title: "The Grepr data lake",
      },
      {
        name: "grepr-model",
        route: "/grepr-platform/grepr-model",
        type: "page",
        title: "The Grepr processing model",
      },
      {
        name: "security",
        route: "/grepr-platform/security",
        type: "page",
        title: "Security in the Grepr platform",
      },
      {
        name: "high-availability",
        route: "/grepr-platform/high-availability",
        type: "page",
        title: "Grepr high availability",
      },
      {
        name: "permissions",
        route: "/grepr-platform/permissions",
        type: "page",
        title: "Permissions in the Grepr platform",
      },
      {
        name: "monitoring",
        route: "/grepr-platform/monitoring",
        type: "page",
        title: "Monitor performance metrics",
      },
    ],
  },
  {
    name: "tutorials",
    route: "/tutorials",
    type: "folder",
    title: "Tutorials",
    children: [
      {
        name: "index",
        route: "/tutorials",
        type: "page",
        title: "Overview",
      },
      {
        name: "first-pipeline",
        route: "/tutorials/first-pipeline",
        type: "page",
        title: "Build your first Grepr pipeline",
      },
      {
        name: "troubleshooting-example",
        route: "/tutorials/troubleshooting-example",
        type: "page",
        title: "Troubleshoot incidents with Grepr-processed data",
      },
      {
        name: "live-edit",
        route: "/tutorials/live-edit",
        type: "page",
        title: "View pipeline data flows and test changes with live edit",
      },
    ],
  },
  {
    name: "pipelines",
    route: "/pipelines",
    type: "folder",
    title: "Process telemetry data with pipelines",
    children: [
      {
        name: "index",
        route: "/pipelines/",
        type: "folder",
        title: "Overview",
      },
      {
        name: "trace-pipelines",
        route: "/pipelines/trace-pipelines",
        type: "page",
        title: "Trace reduction pipelines for APM data",
      },
      {
        name: "agent-sessions",
        route: "/pipelines/agent-sessions",
        type: "page",
        title: "Agent sessions for coding agents",
      },
    ],
  },
  {
    name: "integrations",
    route: "/integrations",
    type: "folder",
    title: "Configure vendor and storage connections",
    children: [
      {
        name: "index",
        route: "/integrations",
        type: "page",
        title: "Overview",
      },
      {
        name: "support-matrix",
        route: "/integrations/support-matrix",
        type: "page",
        title: "Supported vendor and storage integrations",
      },
      {
        name: "datadog",
        route: "/integrations/datadog",
        type: "page",
        title: "Configure Datadog connections",
      },
      {
        name: "new-relic",
        route: "/integrations/new-relic",
        type: "page",
        title: "Configure New Relic connections",
      },
      {
        name: "splunk",
        route: "/integrations/splunk",
        type: "page",
        title: "Configure Splunk connections",
      },
      {
        name: "sumo-logic",
        route: "/integrations/sumo-logic",
        type: "page",
        title: "Configure Sumo Logic connections",
      },
      {
        name: "open-telemetry",
        route: "/integrations/open-telemetry",
        type: "page",
        title: "Configure OpenTelemetry connections",
      },
      {
        name: "grafana",
        route: "/integrations/grafana",
        type: "page",
        title: "Configure Grafana connections",
      },
      {
        name: "cloudwatch",
        route: "/integrations/cloudwatch",
        type: "page",
        title: "Configure CloudWatch connections",
      },
      {
        name: "gcp",
        route: "/integrations/gcp",
        type: "page",
        title: "Configure Google Cloud observability",
      },
      {
        name: "aws-s3",
        route: "/integrations/aws-s3",
        type: "page",
        title: "Use Amazon S3 for your data lake",
      },
    ],
  },
  {
    name: "transforms",
    route: "/transforms",
    type: "folder",
    title: "Process and transform data",
    children: [
      {
        name: "index",
        route: "/transforms",
        type: "page",
        title: "Overview",
      },
      {
        name: "filters",
        route: "/transforms/filter-events",
        type: "page",
        title: "Filter events",
      },
      {
        name: "grok",
        route: "/transforms/grok",
        type: "folder",
        title: "Parse semi-structured data with Grok",
        children: [
          {
            name: "index",
            route: "/transforms/grok",
            type: "page",
            title: "Overview",
          },
          {
            name: "logstash-matchers",
            route: "/transforms/grok/logstash-matchers",
            type: "page",
            title: "Logstash-compatible matchers",
          },
          {
            name: "datadog-matchers",
            route: "/transforms/grok/datadog-matchers",
            type: "page",
            title: "Datadog-compatible matchers",
          },
          {
            name: "transformers",
            route: "/transforms/grok/transformers",
            type: "page",
            title: "Supported Grok transformers",
          },
        ],
      },
      {
        name: "json-parsing",
        route: "/transforms/json-parsing",
        type: "page",
        title: "Transform messages into JSON objects",
      },
      {
        name: "remapper",
        route: "/transforms/remapper",
        type: "page",
        title: "Standardize messages with the remapper",
      },
      {
        name: "reducer",
        route: "/transforms/reducer",
        type: "folder",
        title: "Optimize the size and value of logs",
        children: [
          {
            name: "index",
            route: "/transforms/reducer",
            type: "page",
            title: "Introduction to the log reducer",
          },
          {
            name: "configuration",
            route: "/transforms/reducer/configuration",
            type: "folder",
            title: "Configure the log reducer",
            children: [
              {
                name: "index",
                route: "/transforms/reducer/configuration",
                type: "page",
                title: "Configure the log reducer",
              },
              {
                name: "merge-strategy-examples",
                route:
                  "/transforms/reducer/configuration/merge-strategy-examples",
                type: "page",
                title: "Merge strategy examples",
              },
            ],
          },
          {
            name: "exceptions",
            route: "/transforms/reducer/exceptions",
            type: "page",
            title: "Configure exceptions to log reduction",
          },
        ],
      },
      {
        name: "sql-transform",
        route: "/transforms/sql-transform",
        type: "folder",
        title: "Transform data with SQL",
        children: [
          {
            name: "index",
            route: "/transforms/sql-transform",
            type: "page",
            title: "Overview",
          },
          {
            name: "data-types",
            route: "/transforms/sql-transform/data-types",
            type: "page",
            title: "Supported data types",
          },
          {
            name: "sql-examples",
            route: "/transforms/sql-transform/sql-transform-examples",
            type: "page",
            title: "Example queries",
          },
          {
            name: "sql-functions",
            route: "/transforms/sql-transform/sql-functions",
            type: "page",
            title: "Supported SQL functions and operators",
          },
        ],
      },
    ],
  },
  {
    name: "templates",
    route: "/templates",
    type: "page",
    title: "Create reusable components with templates",
  },
  {
    name: "queries",
    route: "/queries",
    type: "folder",
    title: "Query logs in the data lake",
    children: [
      {
        name: "index",
        route: "/queries",
        type: "page",
        title: "Overview",
      },
      {
        name: "datadog",
        route: "/queries/datadog",
        type: "page",
        title: "Search logs using a Datadog-like syntax",
      },
      {
        name: "new-relic",
        route: "/queries/new-relic",
        type: "page",
        title: "Search logs using a New Relic log query-like syntax",
      },
      {
        name: "analyze",
        route: "/queries/analyze",
        type: "page",
        title: "Aggregate logs with Analyze mode",
      },
    ],
  },
  {
    name: "admin",
    route: "/admin",
    type: "folder",
    title: "Administration",
    children: [
      {
        name: "index",
        route: "/admin",
        type: "page",
        title: "Overview",
      },
      {
        name: "manage-users",
        route: "/admin/manage-users",
        type: "page",
        title: "Manage users",
      },
      {
        name: "manage-teams",
        route: "/admin/manage-teams",
        type: "page",
        title: "Manage teams",
      },
      {
        name: "manage-claim-mappings",
        route: "/admin/manage-claim-mappings",
        type: "page",
        title: "Manage SSO claim mappings",
      },
      {
        name: "service-accounts",
        route: "/admin/service-accounts",
        type: "page",
        title: "Manage service accounts",
      },
      {
        name: "terraform-provider",
        route: "/admin/terraform-provider",
        type: "page",
        title: "Manage Grepr pipelines with Terraform",
      },
      {
        name: "activity-logs",
        route: "/admin/activity-logs",
        type: "page",
        title: "View system activity",
      },
      {
        name: "private-link",
        route: "/admin/private-link",
        type: "page",
        title: "Connect to Grepr with AWS PrivateLink",
      },
    ],
  },
  {
    name: "cli",
    route: "/cli",
    type: "page",
    title: "Grepr CLI",
  },
  {
    name: "apis",
    route: "/apis",
    type: "folder",
    title: "APIs",
    children: [
      {
        name: "index",
        route: "/apis",
        type: "page",
        title: "Overview",
      },
      {
        name: "authentication",
        route: "/apis/authentication",
        type: "page",
        title: "Authenticate to Grepr APIs",
      },
      {
        name: "job-creation-guide",
        route: "/apis/job-creation-guide",
        type: "page",
        title: "Create and manage Grepr jobs",
      },
      {
        name: "job-states",
        route: "/apis/job-states",
        type: "page",
        title: "Track the lifecycle of a job",
      },
      {
        name: "rule-engine",
        route: "/apis/rule-engine",
        type: "page",
        title: "Trigger actions with the rule engine",
      },
      {
        name: "api-spec",
        route: "/apis/api-spec",
        type: "page",
        title: "API Specification",
      },
    ],
  },
  {
    name: "release-notes",
    route: "/release-notes",
    type: "folder",
    title: "Release Notes",
    children: [
      {
        name: "index",
        route: "/release-notes",
        type: "page",
        title: "Overview",
      },
      {
        name: "2026",
        route: "/release-notes/2026",
        type: "folder",
        title: "2026",
        children: [
          {
            name: "august",
            route: "/release-notes/2026/august",
            type: "page",
            title: "August",
          },
          {
            name: "july",
            route: "/release-notes/2026/july",
            type: "page",
            title: "July",
          },
          {
            name: "june",
            route: "/release-notes/2026/june",
            type: "page",
            title: "June",
          },
          {
            name: "may",
            route: "/release-notes/2026/may",
            type: "page",
            title: "May",
          },
          {
            name: "april",
            route: "/release-notes/2026/april",
            type: "page",
            title: "April",
          },
          {
            name: "march",
            route: "/release-notes/2026/march",
            type: "page",
            title: "March",
          },
          {
            name: "february",
            route: "/release-notes/2026/february",
            type: "page",
            title: "February",
          },
          {
            name: "january",
            route: "/release-notes/2026/january",
            type: "page",
            title: "January",
          },
        ],
      },
      {
        name: "2025",
        route: "/release-notes/2025",
        type: "folder",
        title: "2025",
        children: [
          {
            name: "december",
            route: "/release-notes/2025/december",
            type: "page",
            title: "December",
          },
          {
            name: "november",
            route: "/release-notes/2025/november",
            type: "page",
            title: "November",
          },
          {
            name: "october",
            route: "/release-notes/2025/october",
            type: "page",
            title: "October",
          },
          {
            name: "september",
            route: "/release-notes/2025/september",
            type: "page",
            title: "September",
          },
        ],
      },
    ],
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <body>
        <Layout
          editLink={""}
          pageMap={pageMap}
          feedback={{
            link: "https://www.grepr.ai/contact",
            content: "Send questions or feedback",
          }}
          navbar={
            <Navbar logoLink="https://www.grepr.ai" logo={<AppLogo />}>
              <Search />
              <ThemeSwitch />
            </Navbar>
          }
          search={false}
          footer={
            <Footer>
              <div>Powered by Grepr</div>
            </Footer>
          }
          toc={{
            title: "On This Page",
            float: true,
            backToTop: "Scroll to top",
          }}
        >
          {children}
          <Analytics />
        </Layout>
      </body>
    </html>
  );
}
