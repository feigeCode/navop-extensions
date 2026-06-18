package ipc

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestWriteFramePrefixesJSONPayloadWithLittleEndianLength(t *testing.T) {
	var buf bytes.Buffer
	msg := Message{
		JSONRPC: "2.0",
		ID:      json.RawMessage(`1`),
		Method:  "init",
		Params:  json.RawMessage(`{"client":"test"}`),
	}

	if err := WriteFrame(&buf, msg); err != nil {
		t.Fatalf("WriteFrame returned error: %v", err)
	}

	raw := buf.Bytes()
	if len(raw) < 5 {
		t.Fatalf("frame too short: %d bytes", len(raw))
	}
	gotLen := binary.LittleEndian.Uint32(raw[:4])
	if int(gotLen) != len(raw)-4 {
		t.Fatalf("length prefix = %d, payload length = %d", gotLen, len(raw)-4)
	}

	var decoded Message
	if err := json.Unmarshal(raw[4:], &decoded); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	if decoded.Method != "init" {
		t.Fatalf("decoded method = %q, want init", decoded.Method)
	}
}

func TestReadFrameDecodesMessage(t *testing.T) {
	payload := []byte(`{"jsonrpc":"2.0","id":"abc","method":"$/ping","params":{}}`)
	var buf bytes.Buffer
	var prefix [4]byte
	binary.LittleEndian.PutUint32(prefix[:], uint32(len(payload)))
	buf.Write(prefix[:])
	buf.Write(payload)

	msg, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame returned error: %v", err)
	}
	if msg.Method != "$/ping" {
		t.Fatalf("method = %q, want $/ping", msg.Method)
	}
	if string(msg.ID) != `"abc"` {
		t.Fatalf("id = %s, want string id", msg.ID)
	}
}
