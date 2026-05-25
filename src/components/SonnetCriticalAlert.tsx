import { useState } from "react";
import { Alert, Text } from "@mantine/core";
import { IconFlame } from "@tabler/icons-react";

export function SonnetCriticalAlert({ pct }: { pct: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || pct < 95) return null;
  const isFull = pct >= 100;
  return (
    <Alert
      color="red" variant="filled"
      icon={<IconFlame size={18} />}
      withCloseButton
      onClose={() => setDismissed(true)}
      mb="lg"
      title={isFull ? "Sonnet quota exhausted" : "Sonnet quota nearly exhausted"}
    >
      <Text size="sm">
        Rolling 7-day Sonnet usage is at <b>{pct}%</b>.
        {isFull
          ? " New Sonnet requests will be rejected until the window resets."
          : " Consider routing new Sonnet requests to a smaller model or wait for the window to reset."}
      </Text>
    </Alert>
  );
}
