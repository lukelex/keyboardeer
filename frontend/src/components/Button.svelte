<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant =
    | "primary"
    | "danger"
    | "secondary"
    | "text"
    | "link"
    | "key"
    | "palette"
    | "icon"
    | "plain";

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    children?: Snippet;
  }

  // The native default type is "submit", so wrapping a submit control keeps
  // the containing form's behaviour.
  let {
    variant = "secondary",
    class: extraClass = "",
    type = "submit",
    children,
    ...rest
  }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    primary: "button primary",
    danger: "button primary danger-fill",
    secondary: "button secondary",
    text: "button text",
    link: "back-link",
    key: "editor-key",
    palette: "button secondary palette-key",
    icon: "icon-button",
    plain: "",
  };
</script>

<button class={[variantClasses[variant], extraClass]} {type} {...rest}>
  {@render children?.()}
</button>
