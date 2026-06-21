#!/usr/bin/env perl
use strict;
use warnings;
use Getopt::Long qw(GetOptions);
use JSON::PP;

my ($evidence_dir, $out_dir, $policy_input_ref);
GetOptions(
  'evidence-dir=s'     => \$evidence_dir,
  'out-dir=s'          => \$out_dir,
  'policy-input-ref=s' => \$policy_input_ref,
) or die "usage: $0 --evidence-dir PATH --out-dir PATH --policy-input-ref REF\n";

die "missing --evidence-dir\n" unless defined $evidence_dir && length $evidence_dir;
die "missing --out-dir\n" unless defined $out_dir && length $out_dir;
die "missing --policy-input-ref\n" unless defined $policy_input_ref && length $policy_input_ref;

my $json = JSON::PP->new->canonical;
my $json_pretty = JSON::PP->new->canonical->pretty;

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

sub read_json {
  my ($path) = @_;
  open my $fh, '<:encoding(UTF-8)', $path or die "open $path: $!";
  local $/;
  return JSON::PP->new->decode(<$fh>);
}

sub write_jsonl {
  my ($path, $rows) = @_;
  open my $fh, '>:encoding(UTF-8)', $path or die "write $path: $!";
  for my $row (@$rows) {
    print {$fh} $json->encode($row), "\n";
  }
  close $fh;
}

sub write_json {
  my ($path, $row) = @_;
  open my $fh, '>:encoding(UTF-8)', $path or die "write $path: $!";
  print {$fh} $json_pretty->encode($row);
  close $fh;
}

sub md_escape {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value =~ s/\|/\\|/g;
  $value =~ s/\r?\n/ /g;
  return $value;
}

sub decide {
  my ($row) = @_;
  my $path = $row->{sourcePath} // '';
  my $source_class = $row->{sourceClass} // '';

  return ('reject', 'agent_local_note', 'local .agents notes are not accepted durable law authority')
    if $path =~ m{^\.agents/};
  return ('reject', 'historical_iteration_log', 'iteration logs are historical evidence, not active law')
    if $path =~ m{/iteration-log\.md$|/iterations\.jsonl$};
  return ('reject', 'package_build_metadata', 'package build metadata is not policy law')
    if $path =~ m{/package\.json$|/flake\.nix$};
  return ('reject', 'package_readme_documentation', 'package README text is documentation unless backed by policy.md/schema/template authority')
    if $path =~ m{^packages/.*/README\.md$};

  return ('accept', 'schema_structural_contract', 'schema source is a structural contract that policy consumers must validate against')
    if $path =~ m{^schemas/};
  return ('accept', 'template_structural_contract', 'template source is a structural contract for generated/transported records')
    if $path =~ m{^templates/};
  return ('accept', 'kernel_or_module_policy', 'kernel/module policy source is active policy law')
    if $path =~ m{^(kernel|modules)/};
  return ('accept', 'package_policy', 'package policy.md is active package-level policy law')
    if $path =~ m{^packages/.*/policy\.md$};
  return ('accept', 'root_policy_surface', 'root policy surface participates in routing, role, or source-layout law')
    if $path =~ m{^(AGENTS\.md|policy-router\.v1\.json|policy-source-layout\.v1\.json|role-exit-graph\.v1\.json|disruptives\.jsonl|glossary/)};
  return ('accept', 'protocol_contract', 'protocol source is an active workflow/protocol contract')
    if $path =~ m{^protocols/};
  return ('accept', 'role_contract', 'role profile/group source is active role contract data')
    if $path =~ m{^(role-profiles|role-groups)/};

  return ('needs_manual_review', 'unclassified_review_decision', 'no accept/reject rule matched this review-required candidate');
}

my $review_queue = read_jsonl("$evidence_dir/coverage_first_candidate_review_queue.jsonl");
my $reconciliation_summary = read_json("$evidence_dir/coverage_first_candidate_reconciliation_summary.json");

my (@decisions, @accepted_projection, @rejected, @manual);
my (%decision_counts, %reason_counts);

my $index = 0;
for my $row (@$review_queue) {
  $index++;
  my ($decision, $reason_code, $rationale) = decide($row);
  my $decision_row = {
    type => 'policy.retirement.coverageFirstReviewDecision.proposed.v1',
    index => $index,
    policyInputRef => $policy_input_ref,
    candidateId => $row->{candidateId},
    signalId => $row->{signalId},
    sourcePath => $row->{sourcePath},
    lineStart => $row->{lineStart},
    lineEnd => $row->{lineEnd},
    candidateKind => $row->{candidateKind},
    textHash => $row->{textHash},
    text => $row->{text},
    sourceClass => $row->{sourceClass},
    reviewDecision => $decision,
    reasonCode => $reason_code,
    rationale => $rationale,
    proposedProjectedRule => $decision eq 'accept' ? $row->{projectedRule} : undef,
    authorityState => 'proposal-decision-not-canonical-approval',
    deletionApproval => JSON::PP::false,
    cutoverReady => JSON::PP::false,
  };
  push @decisions, $decision_row;
  push @accepted_projection, $decision_row if $decision eq 'accept';
  push @rejected, $decision_row if $decision eq 'reject';
  push @manual, $decision_row if $decision eq 'needs_manual_review';
  $decision_counts{$decision}++;
  $reason_counts{$reason_code}++;
}

write_jsonl("$out_dir/coverage_first_review_decisions.proposed.jsonl", \@decisions);
write_jsonl("$out_dir/coverage_first_review_accepted_projection.proposed.jsonl", \@accepted_projection);
write_jsonl("$out_dir/coverage_first_review_rejections.proposed.jsonl", \@rejected);
write_jsonl("$out_dir/coverage_first_review_manual_queue.jsonl", \@manual);

open my $md, '>:encoding(UTF-8)', "$out_dir/coverage_first_review_decisions.proposed.md"
  or die "write $out_dir/coverage_first_review_decisions.proposed.md: $!";
print {$md} "| # | decision | reason | source | line | kind | projected rule | text |\n";
print {$md} "|---:|---|---|---|---:|---|---|---|\n";
for my $row (@decisions) {
  print {$md} '| ', $row->{index},
    ' | `', md_escape($row->{reviewDecision}), '`',
    ' | `', md_escape($row->{reasonCode}), '`',
    ' | `', md_escape($row->{sourcePath}), '`',
    ' | ', md_escape($row->{lineStart}),
    ' | `', md_escape($row->{candidateKind}), '`',
    ' | `', md_escape($row->{proposedProjectedRule} // ''), '`',
    ' | ', md_escape($row->{text}),
    " |\n";
}
close $md;

my $summary = {
  type => 'policy.retirement.coverageFirstReviewDecisionSummary.proposed.v1',
  policyInputRef => $policy_input_ref,
  reviewRequiredCandidateCount => scalar(@$review_queue),
  decisionRows => scalar(@decisions),
  decisionCounts => \%decision_counts,
  reasonCounts => \%reason_counts,
  acceptedProjectionRows => scalar(@accepted_projection),
  rejectedRows => scalar(@rejected),
  manualReviewRows => scalar(@manual),
  priorReconciliationDecision => $reconciliation_summary->{decision},
  priorReviewBatchCount => $reconciliation_summary->{reviewBatchCount},
  authorityState => 'proposal-decision-not-canonical-approval',
  deletionApproval => JSON::PP::false,
  cutoverReady => JSON::PP::false,
  decision => scalar(@manual) == 0
    ? 'REVIEW_REQUIRED_QUEUE_PROPOSED_DECISIONS_COMPLETE'
    : 'REVIEW_REQUIRED_QUEUE_HAS_MANUAL_REMAINDERS',
  requiredNextProof => [
    'run refreshed Codex as Gen2 against proposed accept/reject decisions',
    'promote accepted decisions through ADRS decision JSONL before claiming authority',
    'project accepted rows into law/policy/runtime artifacts',
  ],
};
write_json("$out_dir/coverage_first_review_decision_summary.proposed.json", $summary);

print $json->encode($summary), "\n";
exit(scalar(@manual) == 0 ? 0 : 1);
