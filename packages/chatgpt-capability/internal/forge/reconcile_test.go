package forge

import "testing"

func TestReconcileStates(t *testing.T) {
	decisions := map[string]DecisionClaim{
		"active":  {Schema: DecisionSchema, ID: "active", Action: "adopt", At: "capabilities/active"},
		"planned": {Schema: DecisionSchema, ID: "planned", Action: "adopt", At: "capabilities/planned"},
		"retired": {Schema: DecisionSchema, ID: "retired", Action: "retire", At: "capabilities/retired"},
		"drift":   {Schema: DecisionSchema, ID: "drift", Action: "retire", At: "capabilities/drift"},
	}
	implementations := map[string]ImplementationClaim{
		"active":    {Schema: ImplementationSchema, ID: "active", At: "capabilities/active", BuildStatus: "PASS"},
		"drift":     {Schema: ImplementationSchema, ID: "drift", At: "capabilities/drift", BuildStatus: "PASS"},
		"unadopted": {Schema: ImplementationSchema, ID: "unadopted", At: "capabilities/unadopted", BuildStatus: "NOT_RUN"},
	}
	dirs := map[string]string{"active": "x", "drift": "x", "unadopted": "x"}
	records := reconcile(decisions, implementations, dirs)
	got := map[string]string{}
	for _, record := range records {
		got[record.ID] = record.Status
	}
	want := map[string]string{"active": "active", "planned": "planned", "retired": "retired", "drift": "drift", "unadopted": "unadopted"}
	for id, status := range want {
		if got[id] != status {
			t.Fatalf("%s: got %q, want %q", id, got[id], status)
		}
	}
}
