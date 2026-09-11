"use client";

import { useEffect, useState } from "react";
import { privateSchoolsAvailable } from "./private-school-support";

// A page can mount one editor per section. Share concurrent metadata checks,
// but do not cache the result across logins or a later migration rollout.
let pendingCheck: Promise<boolean> | undefined;
function checkSupport() {
  pendingCheck ??= privateSchoolsAvailable().finally(() => { pendingCheck = undefined; });
  return pendingCheck;
}

export function usePrivateSchoolSupport() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    checkSupport().then(
      (supported) => { if (active) setAvailable(supported); },
      () => { if (active) setAvailable(false); },
    );
    return () => { active = false; };
  }, []);
  return available;
}
