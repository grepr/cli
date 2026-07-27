"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";

const RedocStandalone = dynamic(
  () => import("redoc").then((mod) => mod.RedocStandalone),
  { ssr: false },
);

const darkTheme = {
  colors: {
    primary: { main: "#90caf9" },
    text: {
      primary: "#e3e3e3",
      secondary: "#b3b3b3",
    },
  },
  sidebar: {
    backgroundColor: "#1e1f24",
    textColor: "#e3e3e3",
  },
};

const lightTheme = {
  colors: {
    primary: { main: "#1976d2" },
    text: {
      primary: "#333333",
      secondary: "#666666",
    },
  },
  typography: {
    code: {
      color: "#c7254e",
      backgroundColor: "#f9f2f4",
    },
  },
  schema: {
    nestedBackground: "#f8f9fa",
  },
  sidebar: {
    backgroundColor: "#fafafa",
    textColor: "#333333",
  },
  rightPanel: {
    backgroundColor: "#f5f7f9",
    textColor: "#333333",
    servers: {
      overlay: {
        backgroundColor: "#ffffff",
        textColor: "#333333",
      },
      url: {
        backgroundColor: "#ffffff",
      },
    },
  },
  codeBlock: {
    backgroundColor: "#ffffff",
  },
  fab: {
    backgroundColor: "#ffffff",
    color: "#1976d2",
  },
};

const ApiSpec = ({ filePath }: { filePath: string }) => {
  const [spec, setSpec] = useState<any>();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    fetch(filePath)
      .then(async (yamlContent) => {
        const res = await yamlContent.json();
        res.servers = [
          {
            url: "https://app.grepr.ai/api",
            description: "Default server",
          },
        ];
        setSpec(JSON.parse(JSON.stringify(res)));
        // We put a time out here to make sure the redoc component is loaded before we try to access the elements
        setTimeout(() => {
          // getting all div wrappers for the headers
          const allElements = document.querySelectorAll('[id^="tag/"]');
          // the tags in openapi spe are in the format 'tag/{tag-name}'
          const filteredElements = Array.from(allElements).filter((element) => {
            const id = element.id;
            // so filter out the elements that have only one '/' in their id
            return (id.match(/\//g) || []).length === 1;
          });

          // override the padding here we can't do it in css since it wouldn't use pure selectors
          filteredElements.forEach((element) => {
            element.setAttribute("style", "padding-bottom: 0px");
            const h2Children = element.querySelectorAll("h2");
            // Changing the font size of the h2 elements so tags look like titles of the sections
            h2Children.forEach((h2) => {
              h2.style.fontSize = "32px";
            });
          });

          // Remove elements from the side bar in redoc.
          // NOTE: See JobsApi.getBackfillsForJob `method for example of how to hide a method
          const menuElements = document.querySelectorAll(
            'li[data-item-id^="tag/"]',
          );
          const removeElements = Array.from(menuElements.values()).filter(
            (element) => {
              const id = element.getAttribute("data-item-id");
              return id?.includes("hidden");
            },
          );
          removeElements.forEach((element) => {
            element.setAttribute("style", "display: none");
          });
        }, 250);
      })
      .catch((error) => console.error("Error Loading OpenAPI Spec: ", error));
  }, []);

  return (
    <div
      style={{
        height: "calc(100vh - 64px)",
        width: "100%",
        overflow: "auto",
      }}
    >
      <RedocStandalone
        key={mounted ? resolvedTheme : "light"}
        spec={spec}
        options={{
          nativeScrollbars: true,
          theme: mounted && resolvedTheme === "dark" ? darkTheme : lightTheme,
        }}
      />
    </div>
  );
};

export default ApiSpec;
