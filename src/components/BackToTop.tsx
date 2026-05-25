import { useState, useEffect } from "react";
import { ActionIcon, Transition } from "@mantine/core";
import { IconArrowUp } from "@tabler/icons-react";

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <Transition mounted={show} transition="slide-up" duration={200}>
      {styles => (
        <ActionIcon
          variant="filled" color="blue" size="lg" radius="xl"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          style={{ ...styles, position: "fixed", right: 16, bottom: "max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,.25)" }}
        >
          <IconArrowUp size={18} />
        </ActionIcon>
      )}
    </Transition>
  );
}
