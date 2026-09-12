package packagedocs

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
)

func RenderContractMarkdown(c PackageContract, d Document) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "# %s\n\n", d.Title)
	fmt.Fprintf(&b, "| Field | Value |\n|---|---|\n")
	fmt.Fprintf(&b, "| Owner package | `%s` |\n", c.PackageID)
	fmt.Fprintf(&b, "| Owner root | `%s` |\n", c.OwnerRoot)
	fmt.Fprintf(&b, "| Package kind | `%s` |\n", c.Kind)
	fmt.Fprintf(&b, "| Document ID | `%s` |\n\n", d.ID)
	fmt.Fprintf(&b, "## Responsibility\n\n%s\n\n", strings.TrimSpace(c.Responsibility))
	fmt.Fprintf(&b, "## External contracts\n\n")
	if len(c.ExternalContracts) == 0 {
		fmt.Fprintf(&b, "None.\n\n")
	} else {
		items := append([]PublicContract(nil), c.ExternalContracts...)
		sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
		for _, x := range items {
			fmt.Fprintf(&b, "### `%s`\n\n", x.ID)
			fmt.Fprintf(&b, "| Field | Contract |\n|---|---|\n")
			fmt.Fprintf(&b, "| Entry point | `%s` |\n", x.EntryPoint)
			fmt.Fprintf(&b, "| Input | %s |\n", x.Input)
			fmt.Fprintf(&b, "| Output | %s |\n", x.Output)
			fmt.Fprintf(&b, "| Error | %s |\n", x.Error)
			fmt.Fprintf(&b, "| Effect | %s |\n", x.Effect)
			fmt.Fprintf(&b, "| Compatibility | %s |\n\n", x.Compatibility)
		}
	}
	fmt.Fprintf(&b, "## Internal contracts\n\n")
	if len(c.InternalContracts) == 0 {
		fmt.Fprintf(&b, "None.\n\n")
	} else {
		items := append([]InternalContract(nil), c.InternalContracts...)
		sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
		for _, x := range items {
			fmt.Fprintf(&b, "### `%s`\n\n%s\n\n", x.ID, strings.TrimSpace(x.Boundary))
			if len(x.Invariants) > 0 {
				fmt.Fprintf(&b, "Invariants:\n\n")
				for _, v := range x.Invariants {
					fmt.Fprintf(&b, "- %s\n", v)
				}
				fmt.Fprintln(&b)
			}
			if len(x.ForbiddenEffects) > 0 {
				fmt.Fprintf(&b, "Forbidden effects:\n\n")
				for _, v := range x.ForbiddenEffects {
					fmt.Fprintf(&b, "- %s\n", v)
				}
				fmt.Fprintln(&b)
			}
		}
	}
	fmt.Fprintf(&b, "## Current consumers\n\n")
	for _, v := range c.CurrentConsumers {
		fmt.Fprintf(&b, "- %s\n", v)
	}
	return b.Bytes()
}
