package contract

// Event is the common in-memory representation for append-only contract JSONL rows.
// The canonical source remains contract JSONL; Go code reads and validates it but
// must not become a second schema authority.
type Event map[string]any

const (
	KindSchema          = "contract.schema.v1"
	KindField           = "contract.field.v1"
	KindFieldDeprecated = "contract.field.deprecated.v1"
	KindEdge            = "contract.edge.v1"
	KindQuery           = "contract.query.v1"
	KindFixture         = "contract.fixture.v1"
	KindAuthorityRule   = "contract.authority_rule.v1"
)
