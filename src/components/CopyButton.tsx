import { useState } from "react";
import { Tooltip, ActionIcon } from "@mantine/core";
import { IconActivity, IconDatabase } from "@tabler/icons-react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Tooltip label={copied ? "Copied!" : "Copy"} withArrow position="top">
      <ActionIcon variant={copied ? "filled" : "default"} color={copied ? "teal" : undefined} size="sm" radius="sm" onClick={copy}>
        {copied ? <IconActivity size={12} /> : <IconDatabase size={12} />}
      </ActionIcon>
    </Tooltip>
  );
}
