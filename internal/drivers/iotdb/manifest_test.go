package iotdb

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestExposesStorageGroupActions(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "extensions", "ipc", "iotdb", "driver.json"))
	if err != nil {
		t.Fatalf("read driver.json: %v", err)
	}
	var manifest struct {
		UI struct {
			Form struct {
				Forms []struct {
					Kind string `json:"kind"`
				} `json:"forms"`
				Actions struct {
					Actions []struct {
						ID      string `json:"id"`
						Targets []struct {
							NodeType string `json:"node_type"`
						} `json:"targets"`
					} `json:"actions"`
				} `json:"actions"`
			} `json:"form"`
		} `json:"ui"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("unmarshal driver.json: %v", err)
	}

	if !hasFormKind(manifest.UI.Form.Forms, "CreateDatabase") {
		t.Fatalf("manifest does not expose CreateDatabase form")
	}
	if !hasActionTarget(manifest.UI.Form.Actions.Actions, "CreateDatabase", "Connection") {
		t.Fatalf("manifest does not expose CreateDatabase action on Connection")
	}
	if !hasActionTarget(manifest.UI.Form.Actions.Actions, "DeleteDatabase", "Database") {
		t.Fatalf("manifest does not expose DeleteDatabase action on Database")
	}
}

func hasFormKind(forms []struct {
	Kind string `json:"kind"`
}, kind string) bool {
	for _, form := range forms {
		if form.Kind == kind {
			return true
		}
	}
	return false
}

func hasActionTarget(actions []struct {
	ID      string `json:"id"`
	Targets []struct {
		NodeType string `json:"node_type"`
	} `json:"targets"`
}, id, nodeType string) bool {
	for _, action := range actions {
		if action.ID != id {
			continue
		}
		for _, target := range action.Targets {
			if target.NodeType == nodeType {
				return true
			}
		}
	}
	return false
}
