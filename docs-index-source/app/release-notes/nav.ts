// Sidebar entries for the release notes. Kept beside the notes so that publishing docs/app/release-notes
// from main (see .github/workflows/publish-docs.yml) carries the nav with the pages.
const releaseNotesNav = {
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
          name: "october",
          route: "/release-notes/2026/october",
          type: "page",
          title: "October",
        },
        {
          name: "september",
          route: "/release-notes/2026/september",
          type: "page",
          title: "September",
        },
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
};

export default releaseNotesNav;
