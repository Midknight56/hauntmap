import { useId, type ReactElement } from "react";

/** A list named by its own heading, so that every list has an accessible name (11.4). */
export function NamedList({ title, children, className }: { title: string; children: ReactElement[]; className?: string }): ReactElement {
  const id = useId();
  return (
    <section className={className === undefined ? "named-list" : `named-list ${className}`}>
      <h3 id={id}>{title}</h3>
      <ul aria-labelledby={id}>{children}</ul>
    </section>
  );
}