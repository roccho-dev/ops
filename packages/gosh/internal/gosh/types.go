package gosh

import (
	"encoding/json"
	"time"
)

const (
	EventsVersion = "v1"
	ResultVersion = "v1"
)

type StageSpec struct {
	ID        string            `json:"id,omitempty"`
	Tool      string            `json:"tool"`
	Args      []string          `json:"args,omitempty"`
	Cwd       string            `json:"cwd,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Stdin     string            `json:"stdin,omitempty"`
	Stdout    string            `json:"stdout,omitempty"`
	TimeoutMS int64             `json:"timeoutMs,omitempty"`
}

type Event struct {
	Kind        string            `json:"kind"`
	Rev         *int64            `json:"rev,omitempty"`
	ID          string            `json:"id,omitempty"`
	Target      string            `json:"target,omitempty"`
	Resolver    string            `json:"resolver,omitempty"`
	Installable string            `json:"installable,omitempty"`
	ProgramRel  string            `json:"programRel,omitempty"`
	ProgramAbs  string            `json:"programAbs,omitempty"`
	TargetKind  string            `json:"targetKind,omitempty"`
	Tool        string            `json:"tool,omitempty"`
	Main        string            `json:"main,omitempty"`
	Path        string            `json:"path,omitempty"`
	Value       string            `json:"value,omitempty"`
	Key         string            `json:"key,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Stages      []StageSpec       `json:"stages,omitempty"`
	Mode        string            `json:"mode,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	SourceLine  int               `json:"-"`
}

type Tool struct {
	ID          string `json:"id"`
	Resolver    string `json:"resolver"`
	Installable string `json:"installable,omitempty"`
	ProgramRel  string `json:"programRel,omitempty"`
	ProgramAbs  string `json:"programAbs,omitempty"`
	Deleted     bool   `json:"-"`
	SourceLine  int    `json:"sourceLine"`
}

type Member struct {
	ID         string `json:"id"`
	Value      string `json:"value,omitempty"`
	Deleted    bool   `json:"-"`
	SourceLine int    `json:"sourceLine"`
}

type Target struct {
	ID         string            `json:"id"`
	Kind       string            `json:"targetKind"`
	Tool       string            `json:"tool,omitempty"`
	Main       string            `json:"main,omitempty"`
	Path       string            `json:"path,omitempty"`
	Value      string            `json:"value,omitempty"`
	Args       []string          `json:"args,omitempty"`
	Stages     []StageSpec       `json:"stages,omitempty"`
	Mode       string            `json:"mode,omitempty"`
	Inputs     map[string]Member `json:"inputs,omitempty"`
	Outputs    map[string]Member `json:"outputs,omitempty"`
	Env        map[string]Member `json:"env,omitempty"`
	Deleted    bool              `json:"-"`
	SourceLine int               `json:"sourceLine"`
}

type Check struct {
	ID         string   `json:"id"`
	Target     string   `json:"target"`
	Tool       string   `json:"tool"`
	Args       []string `json:"args,omitempty"`
	Deleted    bool     `json:"-"`
	SourceLine int      `json:"sourceLine"`
}

type State struct {
	Tools     map[string]Tool   `json:"tools"`
	Targets   map[string]Target `json:"targets"`
	Checks    map[string]Check  `json:"checks"`
	InputSHA  string            `json:"inputSha256"`
	LineCount int               `json:"lineCount"`
}

type PlanStep struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Deps        []string `json:"deps,omitempty"`
	Tool        string   `json:"tool,omitempty"`
	Target      string   `json:"target,omitempty"`
	SourceLines []int    `json:"sourceLines,omitempty"`
}

type Plan struct {
	Version   string     `json:"version"`
	Requested string     `json:"requested"`
	InputSHA  string     `json:"inputSha256"`
	PlanSHA   string     `json:"planSha256"`
	Steps     []PlanStep `json:"steps"`
}

type ResolvedTool struct {
	ID               string `json:"id"`
	Backend          string `json:"backend"`
	OutPath          string `json:"outPath,omitempty"`
	ProgramAbs       string `json:"programAbs"`
	Fingerprint      string `json:"fingerprint"`
	ExecutableSHA256 string `json:"executableSha256,omitempty"`
}

type StreamEvidence struct {
	Bytes     int64  `json:"bytes"`
	SHA256    string `json:"sha256"`
	Captured  string `json:"captured,omitempty"`
	Truncated bool   `json:"truncated"`
	Sink      string `json:"sink,omitempty"`
}

type StageResult struct {
	ID         string         `json:"id"`
	ProgramAbs string         `json:"programAbs"`
	Argv       []string       `json:"argv"`
	Cwd        string         `json:"cwd"`
	EnvKeys    []string       `json:"environmentKeys,omitempty"`
	Started    bool           `json:"started"`
	ExitCode   int            `json:"exitCode"`
	DurationMS int64          `json:"durationMs"`
	Status     string         `json:"status"`
	Stdout     StreamEvidence `json:"stdout"`
	Stderr     StreamEvidence `json:"stderr"`
}

type RunResult struct {
	Kind          string            `json:"kind"`
	Version       string            `json:"version"`
	ResultID      string            `json:"resultId"`
	RunID         string            `json:"runId"`
	StartedAt     time.Time         `json:"startedAt"`
	FinishedAt    time.Time         `json:"finishedAt"`
	DurationMS    int64             `json:"durationMs"`
	Requested     string            `json:"requested"`
	InputSHA      string            `json:"inputSha256"`
	PlanSHA       string            `json:"planSha256"`
	Platform      string            `json:"platform"`
	Architecture  string            `json:"architecture"`
	ResolvedTools []ResolvedTool    `json:"resolvedTools,omitempty"`
	Stages        []StageResult     `json:"stages,omitempty"`
	EnvKeys       []string          `json:"environmentKeys,omitempty"`
	Status        string            `json:"status"`
	Changed       bool              `json:"changed"`
	ErrorCode     string            `json:"errorCode,omitempty"`
	Diagnostic    string            `json:"diagnostic,omitempty"`
	Cleanup       string            `json:"cleanup"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

type CommandOutput struct {
	OK    bool            `json:"ok"`
	Kind  string          `json:"kind"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
	Code  string          `json:"code,omitempty"`
}
