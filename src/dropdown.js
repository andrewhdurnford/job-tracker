// Wraps a native <select> with a custom-styled trigger + listbox, so the
// native element stays the source of truth (value, options, change events)
// while the visible UI can be fully themed. Call sync() any time the
// select's options, value, or hidden state change from outside a user click.
export function enhanceSelect(select) {
  const wrap = document.createElement("div");
  wrap.className = "dselect";
  select.insertAdjacentElement("beforebegin", wrap);
  wrap.append(select);
  select.classList.add("dselect-native");
  select.tabIndex = -1;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dselect-trigger";
  wrap.append(trigger);

  const menu = document.createElement("ul");
  menu.className = "dselect-menu";
  menu.setAttribute("role", "listbox");
  wrap.append(menu);

  let open = false;

  function sync() {
    wrap.hidden = select.hidden;
    trigger.textContent = select.options[select.selectedIndex]?.textContent ?? "";
    menu.replaceChildren(
      ...[...select.options].map((opt) => {
        const li = document.createElement("li");
        li.textContent = opt.textContent;
        li.setAttribute("role", "option");
        li.className = "dselect-option" + (opt.value === select.value ? " selected" : "");
        li.addEventListener("click", () => {
          select.value = opt.value;
          select.dispatchEvent(new Event("change"));
          sync();
          closeMenu();
        });
        return li;
      }),
    );
  }

  function openMenu() {
    if (open) return;
    open = true;
    wrap.classList.add("open");
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    wrap.classList.remove("open");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) closeMenu();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      closeMenu();
      trigger.focus();
    }
  }

  trigger.addEventListener("click", () => (open ? closeMenu() : openMenu()));

  sync();
  return { sync };
}
