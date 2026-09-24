<script lang="ts">
  type ButtonVariant =
    | "primary"
    | "secondary"
    | "text"
    | "link"
    | "key"
    | "palette"
    | "icon"
    | "plain";

  type NativeButtonType = "button" | "submit" | "reset";

  export let variant: ButtonVariant = "secondary";
  export let className = "";
  // Match the native <button> default so wrapping a submit control preserves
  // the containing form's existing behavior.
  export let type: NativeButtonType = "submit";
  export let disabled = false;

  const variantClasses: Record<ButtonVariant, string> = {
    primary: "button primary",
    secondary: "button secondary",
    text: "button text",
    link: "back-link",
    key: "editor-key",
    palette: "button secondary palette-key",
    icon: "icon-button",
    plain: "",
  };

  $: classes = [variantClasses[variant], className].filter(Boolean).join(" ");
</script>

<button class={classes} {type} {disabled} {...$$restProps} on:click>
  <slot />
</button>
