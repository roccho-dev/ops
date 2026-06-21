#!/usr/bin/env perl
use strict;
use warnings;
use Getopt::Long qw(GetOptions);
use JSON::PP;

my ($evidence_dir, $out_dir, $policy_input_ref, $ops_head, $adrs_head);
GetOptions(
  'evidence-dir=s'     => \$evidence_dir,
  'out-dir=s'          => \$out_dir,
  'policy-input-ref=s' => \$policy_input_ref,
  'ops-head=s'         => \$ops_head,
  'adrs-head=s'        => \$adrs_head,
) or die "usage: $0 --evidence-dir PATH --out-dir PATH --policy-input-ref REF --ops-head SHA --adrs-head SHA\n";

die "missing --evidence-dir\n" unless defined $evidence_dir && length $evidence_dir;
die "missing --out-dir\n" unless defined $out_dir && length $out_dir;
die "missing --policy-input-ref\n" unless defined $policy_input_ref && length $policy_input_ref;
$ops_head = 'unknown' unless defined $ops_head && length $ops_head;
$adrs_head = 'unknown' unless defined $adrs_head && length $adrs_head;

my $json = JSON::PP->new->canonical;
my $json_pretty = JSON::PP->new->canonical->pretty;

sub read_json {
  my ($path) = @_;
  open my $fh, '<:encoding(UTF-8)', $path or die "open $path: $!";
  local $/;
  return JSON::PP->new->decode(<$fh>);
}

sub read_jsonl {
  my ($path) = @_;
  open my $fh, '<:encoding(UTF-8)', $path or die "open $path: $!";
  my @rows;
  while (my $line = <$fh>) {
    next unless $line =~ /\S/;
    push @rows, JSON::PP->new->decode($line);
  }
  close $fh;
  return \@rows;
}

sub write_json {
  my ($path, $row) = @_;
  open my $fh, '>:encoding(UTF-8)', $path or die "write $path: $!";
  print {$fh} $json_pretty->encode($row);
  close $fh;
}

sub gate_status {
  my ($rows, $gate_id) = @_;
  for my $row (@$rows) {
    return $row->{status} if ($row->{gate_id} // '') eq $gate_id;
  }
  return 'missing';
}

my $without = read_json("$evidence_dir/without_deletion_proof_summary.json");
my $reconcile = read_json("$evidence_dir/coverage_first_candidate_reconciliation_summary.json");
my $review = read_json("$evidence_dir/coverage_first_review_decision_summary.proposed.json");
my $packets = read_json("$evidence_dir/gen2_law_behavior_packet_summary.proposed.json");
my $readiness = read_json("$evidence_dir/deletion_readiness_manifest.json");
my $gates = read_jsonl("$evidence_dir/deletion_readiness_gates.jsonl");
my $gen2_table = read_jsonl("$evidence_dir/gen2_legacy_policy_exhaustive_obligation_table_verification.jsonl");
my $gen2_packets = read_jsonl("$evidence_dir/gen2_law_behavior_packet_verification.jsonl");

my $non_deletion_gates_pass =
  gate_status($gates, 'scan-roots-present') eq 'pass'
  && gate_status($gates, 'active-policy-consumers-zero') eq 'pass'
  && gate_status($gates, 'policy-absent-consumers-pass') eq 'pass'
  && gate_status($gates, 'explicit-consumer-proofs-pass') eq 'pass'
  && gate_status($gates, 'deletion-readiness-does-not-claim-cutover') eq 'pass';

my $audit = {
  type => 'policy.retirement.withoutDeletionCompletionAudit.v1',
  policyInputRef => $policy_input_ref,
  inputEvidenceOpsHead => $ops_head,
  adrsHead => $adrs_head,
  decision => 'WITHOUT_DELETION_PROOF_COMPLETE_NOT_DELETION_OR_CANONICAL_APPROVAL',
  proofState => {
    compilerLaneComplete => $without->{allLegacyObligationsProjected} ? JSON::PP::true : JSON::PP::false,
    legacyCompilerObligationRows => $without->{legacyObligationCount},
    compilerProjectedRules => $without->{projectedRuleCount},
    compilerProjectionFailures => scalar(@{ $without->{legacyObligationProjectionFailures} // [] }),
    coverageFirstCandidatesClassified => $reconcile->{candidateReconciliationRows} == $reconcile->{semanticCandidateCount} ? JSON::PP::true : JSON::PP::false,
    coverageFirstSemanticCandidates => $reconcile->{semanticCandidateCount},
    coverageFirstUnclassifiedCandidates => $reconcile->{unclassifiedCandidateCount},
    coverageFirstReviewRequiredRows => $reconcile->{reviewRequiredCandidateCount},
    reviewDecisionRows => $review->{decisionRows},
    reviewAcceptedProjectionRows => $review->{acceptedProjectionRows},
    reviewRejectedRows => $review->{rejectedRows},
    reviewManualRows => $review->{manualReviewRows},
    exhaustiveObligationRows => $review->{exhaustiveObligationRows},
    gen2LawBehaviorExpectationRows => $packets->{expectationRows},
    gen2LawBehaviorPackets => $packets->{packetRows},
    gen2TableVerificationPass => ($gen2_table->[0]{verdict} // '') eq 'PASS' ? JSON::PP::true : JSON::PP::false,
    gen2PacketVerificationPass => ($gen2_packets->[0]{verdict} // '') eq 'PASS' ? JSON::PP::true : JSON::PP::false,
  },
  readinessState => {
    nonDeletionGatesPass => $non_deletion_gates_pass ? JSON::PP::true : JSON::PP::false,
    activeRuntimeReferenceCount => $readiness->{activeRuntimeReferenceCount},
    policyAbsentConsumersPass => $readiness->{policyAbsentConsumersPass} ? JSON::PP::true : JSON::PP::false,
    consumerProofsPass => $readiness->{consumerProofsPass} ? JSON::PP::true : JSON::PP::false,
    deletionApprovalGate => gate_status($gates, 'deletion-approved'),
    policyDeletionApproved => JSON::PP::false,
    cutoverReady => JSON::PP::false,
  },
  completionScope => {
    actualDeletionExcluded => JSON::PP::true,
    canonicalApprovalGranted => JSON::PP::false,
    policyGitRetirementApprovalGranted => JSON::PP::false,
    cutoverApprovalGranted => JSON::PP::false,
    ssotAdoptionApprovalGranted => JSON::PP::false,
    mergeApprovalGranted => JSON::PP::false,
  },
  goalStatusMap => [
    { goal => 'G24', status => 'achieved-for-proposal-evidence', evidence => 'fresh Gen2 verifications for reconciliation, decisions, exhaustive table, and law behavior packets' },
    { goal => 'G25', status => 'achieved-for-proposal-evidence', evidence => 'coverage-first classified, reviewed, tabled, packetized, and Gen2 verified' },
    { goal => 'G26', status => 'achieved-by-absorption-record', evidence => 'g26 typed-semantic absorption judgment remains coverage-first evidence lane' },
    { goal => 'G27', status => 'non-deletion-gates-pass-deletion-approval-blocked', evidence => 'deletion_readiness_gates.jsonl' },
    { goal => 'G28', status => 'not-achieved', evidence => 'policy.git deletion/retirement approval false' },
    { goal => 'G29', status => 'achieved-for-proposal-evidence', evidence => 'OPS evidence pack plus ADRS g32-g36 audit records' },
    { goal => 'G30', status => 'achieved-for-proposal-evidence', evidence => 'decision ledger refs can reconstruct proof without conversation memory' },
  ],
  remainingApprovals => [
    'policy.git deletion approval',
    'policy.git retirement approval',
    'cutover approval',
    'canonical write approval',
    'SSOT adoption approval',
    'merge approval'
  ],
  statement => 'All requested non-deletion proof artifacts are present as proposal evidence: exhaustive table, per-row Gen2 law behavior expectations, packet coverage, fresh Gen2 verification, and non-deletion readiness gates. This does not grant deletion, retirement, cutover, canonical write, SSOT adoption, or merge approval.',
  auditMaterializationNote => 'inputEvidenceOpsHead is the proof evidence head consumed by this audit. The audit file itself is stored in a later proposal commit.',
};

write_json("$out_dir/without_deletion_completion_audit.json", $audit);
print $json->encode($audit), "\n";

my $ok =
  $audit->{proofState}{compilerLaneComplete}
  && $audit->{proofState}{coverageFirstCandidatesClassified}
  && $audit->{proofState}{coverageFirstUnclassifiedCandidates} == 0
  && $audit->{proofState}{reviewManualRows} == 0
  && $audit->{proofState}{exhaustiveObligationRows} == 2648
  && $audit->{proofState}{gen2LawBehaviorExpectationRows} == 2648
  && $audit->{proofState}{gen2TableVerificationPass}
  && $audit->{proofState}{gen2PacketVerificationPass}
  && $audit->{readinessState}{nonDeletionGatesPass}
  && !$audit->{readinessState}{policyDeletionApproved}
  && !$audit->{readinessState}{cutoverReady};

exit($ok ? 0 : 1);
