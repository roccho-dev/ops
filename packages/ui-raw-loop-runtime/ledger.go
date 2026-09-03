package semanticlog

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const AcceptedRecordKind = "semantic.intent.accepted.v1"

type AppendStatus string

const (
	AppendStatusAppended AppendStatus = "appended"
	AppendStatusNoChange AppendStatus = "no_change"
)

var (
	ErrConflict      = errors.New("semantic intent intent_id conflict")
	ErrCorruptLedger = errors.New("corrupt authoring-intent ledger")
)

type AcceptedRecord struct {
	Kind       string `json:"kind"`
	AcceptedAt string `json:"accepted_at"`
	Digest     string `json:"digest"`
	Intent     Intent `json:"intent"`
}

type AppendResult struct {
	Status   AppendStatus `json:"status"`
	IntentID string       `json:"intent_id"`
	Digest   string       `json:"digest"`
}

type Ledger struct {
	Path string
	Now  func() time.Time
}

var appendMutex sync.Mutex

func (ledger Ledger) Append(intent Intent) (AppendResult, error) {
	if ledger.Path == "" {
		return AppendResult{}, errors.New("ledger path is required")
	}
	if err := intent.Validate(); err != nil {
		return AppendResult{}, err
	}
	digest, err := intent.Digest()
	if err != nil {
		return AppendResult{}, err
	}

	appendMutex.Lock()
	defer appendMutex.Unlock()

	directory := filepath.Dir(ledger.Path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return AppendResult{}, fmt.Errorf("create ledger directory: %w", err)
	}
	_, statErr := os.Stat(ledger.Path)
	created := errors.Is(statErr, os.ErrNotExist)
	if statErr != nil && !created {
		return AppendResult{}, fmt.Errorf("stat ledger: %w", statErr)
	}

	file, err := os.OpenFile(ledger.Path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return AppendResult{}, fmt.Errorf("open ledger: %w", err)
	}
	defer file.Close()
	if err := file.Chmod(0o600); err != nil {
		return AppendResult{}, fmt.Errorf("restrict ledger mode: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return AppendResult{}, fmt.Errorf("lock ledger: %w", err)
	}
	defer syscall.Flock(int(file.Fd()), syscall.LOCK_UN)

	records, err := readAcceptedRecords(file)
	if err != nil {
		return AppendResult{}, err
	}
	for _, record := range records {
		if record.Intent.IntentID != intent.IntentID {
			continue
		}
		if record.Digest == digest {
			return AppendResult{Status: AppendStatusNoChange, IntentID: intent.IntentID, Digest: digest}, nil
		}
		return AppendResult{}, fmt.Errorf("%w: intent_id %q already has digest %s", ErrConflict, intent.IntentID, record.Digest)
	}

	now := time.Now
	if ledger.Now != nil {
		now = ledger.Now
	}
	record := AcceptedRecord{
		Kind:       AcceptedRecordKind,
		AcceptedAt: now().UTC().Format(time.RFC3339Nano),
		Digest:     digest,
		Intent:     intent,
	}
	line, err := marshalCompact(record)
	if err != nil {
		return AppendResult{}, fmt.Errorf("encode accepted record: %w", err)
	}
	line = append(line, '\n')
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		return AppendResult{}, fmt.Errorf("seek ledger end: %w", err)
	}
	if err := writeAll(file, line); err != nil {
		return AppendResult{}, fmt.Errorf("append ledger: %w", err)
	}
	if err := file.Sync(); err != nil {
		return AppendResult{}, fmt.Errorf("fsync ledger: %w", err)
	}
	if created {
		if err := syncDirectory(directory); err != nil {
			return AppendResult{}, err
		}
	}
	return AppendResult{Status: AppendStatusAppended, IntentID: intent.IntentID, Digest: digest}, nil
}

func (ledger Ledger) Read() ([]AcceptedRecord, error) {
	if ledger.Path == "" {
		return nil, errors.New("ledger path is required")
	}
	appendMutex.Lock()
	defer appendMutex.Unlock()

	file, err := os.Open(ledger.Path)
	if errors.Is(err, os.ErrNotExist) {
		return []AcceptedRecord{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open ledger: %w", err)
	}
	defer file.Close()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH); err != nil {
		return nil, fmt.Errorf("lock ledger: %w", err)
	}
	defer syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	return readAcceptedRecords(file)
}

func readAcceptedRecords(reader io.ReadSeeker) ([]AcceptedRecord, error) {
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek ledger start: %w", err)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read ledger: %w", err)
	}
	if len(data) == 0 {
		return []AcceptedRecord{}, nil
	}
	if data[len(data)-1] != '\n' {
		return nil, fmt.Errorf("%w: non-newline-terminated tail", ErrCorruptLedger)
	}

	lines := bytes.Split(data[:len(data)-1], []byte{'\n'})
	records := make([]AcceptedRecord, 0, len(lines))
	seen := make(map[string]string, len(lines))
	for index, line := range lines {
		if len(line) == 0 {
			return nil, fmt.Errorf("%w: blank row at line %d", ErrCorruptLedger, index+1)
		}
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		var record AcceptedRecord
		if err := decoder.Decode(&record); err != nil {
			return nil, fmt.Errorf("%w: line %d: %v", ErrCorruptLedger, index+1, err)
		}
		if err := requireLedgerEOF(decoder); err != nil {
			return nil, fmt.Errorf("%w: line %d: %v", ErrCorruptLedger, index+1, err)
		}
		if record.Kind != AcceptedRecordKind {
			return nil, fmt.Errorf("%w: line %d has kind %q", ErrCorruptLedger, index+1, record.Kind)
		}
		if _, err := time.Parse(time.RFC3339Nano, record.AcceptedAt); err != nil {
			return nil, fmt.Errorf("%w: line %d has invalid accepted_at", ErrCorruptLedger, index+1)
		}
		if err := record.Intent.Validate(); err != nil {
			return nil, fmt.Errorf("%w: line %d: %v", ErrCorruptLedger, index+1, err)
		}
		digest, err := record.Intent.Digest()
		if err != nil || record.Digest != digest {
			return nil, fmt.Errorf("%w: line %d digest mismatch", ErrCorruptLedger, index+1)
		}
		canonical, err := marshalCompact(record)
		if err != nil || !bytes.Equal(line, canonical) {
			return nil, fmt.Errorf("%w: line %d is not canonical", ErrCorruptLedger, index+1)
		}
		if prior, exists := seen[record.Intent.IntentID]; exists {
			return nil, fmt.Errorf("%w: duplicate intent_id %q (%s, %s)", ErrCorruptLedger, record.Intent.IntentID, prior, record.Digest)
		}
		seen[record.Intent.IntentID] = record.Digest
		records = append(records, record)
	}
	return records, nil
}

func marshalCompact(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func requireLedgerEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("trailing JSON value")
		}
		return err
	}
	return nil
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open ledger directory for fsync: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("fsync ledger directory: %w", err)
	}
	return nil
}
