"use client";

import { HMSPrebuilt } from "@100mslive/roomkit-react";

export default function CustomerRoom({ authToken }: { authToken: string }) {
  return (
    <div style={{ height: "calc(100vh - 56px)", width: "100%" }}>
      <HMSPrebuilt authToken={authToken} />
    </div>
  );
}
