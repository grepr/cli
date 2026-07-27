"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const AppLogo: React.FC = () => {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid hydration mismatch by not applying theme-dependent styles until mounted
  const isDarkMode = mounted && resolvedTheme === "dark";

  return (
    <img
      id="grepr-logo"
      src="/images/BlackLogoNoText-256px.png"
      alt="Grepr Logo"
      style={{
        filter: isDarkMode ? "invert(1)" : "none",
      }}
    />
  );
};

export default AppLogo;
