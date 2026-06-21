#!/usr/bin/env perl
use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use Encode qw(encode_utf8);
use File::Path qw(make_path);
use Getopt::Long qw(GetOptions);
use JSON::PP;

my ($coverage_dir, $evidence_dir, $out_dir, $policy_input_ref);
GetOptions(
  'coverage-dir=s'     => \$coverage_dir,
  'evidence-dir=s'     => \$evidence_dir,
  'out-dir=s'          => \$out_dir,
  'policy-input-ref=s' => \$policy_input_ref,
) or die "usage: $0 --coverage-dir PATH --evidence-dir PATH --out-dir PATH --policy-input-ref REF\n";

die "missing --coverage-dir\n" unless defined $coverage_dir && length $coverage_dir;
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

sub norm {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value =~ s/\s+/ /g;
  $value =~ s/^\s+|\s+$//g;
  return $value;
}

sub text_hash {
  my ($value) = @_;
  return sha256_hex(encode_utf8(norm($value)));
}

sub md_escape {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value =~ s/\|/\\|/g;
  $value =~ s/\r?\n/ /g;
  return $value;
}

sub rule_slug {
  my ($prefix, $id, $index) = @_;
  my $slug = defined $id && length $id ? $id : "$prefix-$index";
  $slug =~ s/[^A-Za-z0-9._-]+/-/g;
  $slug =~ s/^-+|-+$//g;
  $slug = "$prefix-$index" unless length $slug;
  return lc($slug);
}

sub source_class_for {
  my ($path) = @_;
  $path = '' unless defined $path;
  return 'historical_or_generated_policy_event_log'
    if $path =~ m{^policy-tantivy-cython/(data/events|data/source)/};
  return 'generated_policy_projection_report'
    if $path =~ m{^policy-tantivy-cython/};
  return 'board_or_runtime_projection_record'
    if $path =~ m{^boards/};
  return 'historical_report_or_audit_output'
    if $path =~ m{^reports/} || $path eq 'REVIEW.md';
  return 'proposal_or_issue_discussion'
    if $path =~ m{^(docs|issues|records/future-lane)/};
  return 'example_fixture_or_test_asset'
    if $path =~ m{(^tests/|^destructive-cases/|/examples?/|fixture|golden|sample)}i;
  return 'schema_or_template_contract'
    if $path =~ m{^(schemas|templates)/};
  return 'policy_runtime_package_surface'
    if $path =~ m{^packages/};
  return 'policy_module_or_kernel_surface'
    if $path =~ m{^(modules|kernel|role-profiles|role-groups|protocols)/};
  return 'root_policy_surface'
    if $path =~ m{^(AGENTS\.md|policy-router\.v1\.json|policy-source-layout\.v1\.json|role-exit-graph\.v1\.json|disruptives\.jsonl|glossary/)};
  return 'build_or_snapshot_metadata'
    if $path =~ m{^(flake\.nix|package\.json|package-lock\.json|SNAPSHOT_MANIFEST\.md|MERGE_SOURCE\.md|TEST_RESULTS\.txt|LOCALIZATION_REPORT\.md|SMARTER_WORKTREE_REPORT\.md|VISIBLE_POLICY_SOURCE_WORKTREE_REPORT\.md|nix/)};
  return 'agent_local_surface'
    if $path =~ m{^\.agents/};
  return 'unclassified_source_surface';
}

sub disposition_for_source_class {
  my ($source_class) = @_;
  return 'non_authority_historical_generated_or_mirror'
    if $source_class =~ /^(historical_or_generated_policy_event_log|generated_policy_projection_report|board_or_runtime_projection_record|historical_report_or_audit_output|proposal_or_issue_discussion|example_fixture_or_test_asset)$/;
  return 'accepted_law_candidate_requires_review'
    if $source_class =~ /^(schema_or_template_contract|policy_runtime_package_surface|policy_module_or_kernel_surface|root_policy_surface|agent_local_surface)$/;
  return 'non_policy_build_or_snapshot_metadata'
    if $source_class eq 'build_or_snapshot_metadata';
  return 'requires_review_unclassified_source_surface';
}

make_path($out_dir);

my $semantic_candidates = read_jsonl("$coverage_dir/semantic_candidates.jsonl");
my $unresolved_rows = read_jsonl("$coverage_dir/unresolved_rows.jsonl");
my $legacy_rows = read_jsonl("$evidence_dir/legacy_policy_obligation_table.jsonl");
my $summary = read_json("$evidence_dir/without_deletion_proof_summary.json");

my (%native_signal, %native_scope_text, %native_text, %native_by_signal, %native_by_scope_text, %native_by_text);
for my $row (@$legacy_rows) {
  my $signal_id = $row->{signalId} // '';
  my $scope = $row->{scope} // '';
  my $hash = text_hash($row->{text});
  $native_signal{$signal_id} = 1 if length $signal_id;
  $native_by_signal{$signal_id} = $row if length $signal_id;
  $native_scope_text{"$scope\0$hash"} = 1;
  $native_by_scope_text{"$scope\0$hash"} = $row;
  $native_text{$hash} = 1;
  $native_by_text{$hash} = $row;
}

my %unresolved_by_disposition;
for my $row (@$unresolved_rows) {
  $unresolved_by_disposition{$row->{disposition} // 'unknown'}++;
}

my (@reconciled, @review_queue, @unified_table);
my (%counts, %source_class_counts, %disposition_counts, %match_counts);

my $index = 0;
for my $candidate (@$semantic_candidates) {
  $index++;
  my $source_path = $candidate->{sourcePath} // '';
  my $hash = text_hash($candidate->{text});
  my ($match_method, $matched_native) = ('none', undef);
  if (($candidate->{signalId} // '') ne '' && $native_signal{$candidate->{signalId}}) {
    $match_method = 'signal_id';
    $matched_native = $native_by_signal{$candidate->{signalId}};
  } elsif ($native_scope_text{"$source_path\0$hash"}) {
    $match_method = 'source_path_text_hash';
    $matched_native = $native_by_scope_text{"$source_path\0$hash"};
  } elsif ($native_text{$hash}) {
    $match_method = 'text_hash_only';
    $matched_native = $native_by_text{$hash};
  }

  my $source_class = source_class_for($source_path);
  my $candidate_disposition;
  my $projection_status;
  my $review_required = JSON::PP::false;
  my $projected_rule = undef;
  my $rationale;

  if ($match_method ne 'none') {
    $candidate_disposition = 'covered_by_compiler_projection';
    $projection_status = 'projected_by_compiler_lane';
    $projected_rule = 'rules/' . rule_slug('native', $matched_native->{nativeId} // $matched_native->{signalId}, $index) . '.md';
    $rationale = 'candidate matches a compiler native row and inherits the already verified one-to-one projected rule';
  } else {
    $candidate_disposition = disposition_for_source_class($source_class);
    if ($candidate_disposition eq 'accepted_law_candidate_requires_review' || $candidate_disposition eq 'requires_review_unclassified_source_surface') {
      $projection_status = 'candidate_rule_materialized_for_review';
      $review_required = JSON::PP::true;
      $projected_rule = 'coverage-candidate-rules/' . rule_slug('candidate', $candidate->{id} // $candidate->{signalId}, $index) . '.md';
      $rationale = 'coverage-first marks this as authority-relevant, but no accepted equivalence/adoption proof maps it into compiler projection yet';
    } else {
      $projection_status = 'not_projected_non_authority_or_generated_source';
      $rationale = 'source class is historical, generated, fixture, proposal, board, report, or metadata evidence rather than accepted law authority';
    }
  }

  my $row = {
    type => 'policy.retirement.coverageFirstCandidateReconciliation.v1',
    index => $index,
    candidateId => $candidate->{id},
    signalId => $candidate->{signalId},
    sourcePath => $source_path,
    lineStart => $candidate->{lineStart},
    lineEnd => $candidate->{lineEnd},
    candidateKind => $candidate->{candidateKind},
    textHash => $hash,
    text => $candidate->{text},
    matchMethod => $match_method,
    matchedNativeId => $matched_native ? $matched_native->{nativeId} : undef,
    sourceClass => $source_class,
    candidateDisposition => $candidate_disposition,
    projectionStatus => $projection_status,
    projectedRule => $projected_rule,
    reviewRequired => $review_required,
    rationale => $rationale,
  };
  push @reconciled, $row;
  push @review_queue, $row if $review_required;
  push @unified_table, $row if $projection_status ne 'not_projected_non_authority_or_generated_source';
  $counts{$projection_status}++;
  $source_class_counts{$source_class}++;
  $disposition_counts{$candidate_disposition}++;
  $match_counts{$match_method}++;
}

write_jsonl("$out_dir/coverage_first_candidate_reconciliation.jsonl", \@reconciled);
write_jsonl("$out_dir/coverage_first_candidate_review_queue.jsonl", \@review_queue);
write_jsonl("$out_dir/legacy_policy_unified_obligation_table.jsonl", \@unified_table);

open my $md, '>:encoding(UTF-8)', "$out_dir/legacy_policy_unified_obligation_table.md"
  or die "write $out_dir/legacy_policy_unified_obligation_table.md: $!";
print {$md} "| # | status | disposition | source | line | kind | projected rule | text |\n";
print {$md} "|---:|---|---|---|---:|---|---|---|\n";
my $table_index = 0;
for my $row (@unified_table) {
  $table_index++;
  print {$md} '| ', $table_index,
    ' | `', md_escape($row->{projectionStatus}), '`',
    ' | `', md_escape($row->{candidateDisposition}), '`',
    ' | `', md_escape($row->{sourcePath}), '`',
    ' | ', md_escape($row->{lineStart}),
    ' | `', md_escape($row->{candidateKind}), '`',
    ' | `', md_escape($row->{projectedRule} // ''), '`',
    ' | ', md_escape($row->{text}),
    " |\n";
}
close $md;

my $summary_row = {
  type => 'policy.retirement.coverageFirstCandidateReconciliationSummary.v1',
  policyInputRef => $policy_input_ref,
  semanticCandidateCount => scalar(@$semantic_candidates),
  compilerLegacyObligationCount => scalar(@$legacy_rows),
  compilerProjectedRuleCount => $summary->{projectedRuleCount},
  allCompilerLegacyObligationsProjected => $summary->{allLegacyObligationsProjected} ? JSON::PP::true : JSON::PP::false,
  candidateReconciliationRows => scalar(@reconciled),
  unclassifiedCandidateCount => ($disposition_counts{requires_review_unclassified_source_surface} // 0),
  reviewRequiredCandidateCount => scalar(@review_queue),
  unifiedObligationTableRows => scalar(@unified_table),
  projectionStatusCounts => \%counts,
  matchMethodCounts => \%match_counts,
  sourceClassCounts => \%source_class_counts,
  candidateDispositionCounts => \%disposition_counts,
  unresolvedRows => scalar(@$unresolved_rows),
  unresolvedDispositionCounts => \%unresolved_by_disposition,
  deletionApproval => JSON::PP::false,
  cutoverReady => JSON::PP::false,
  decision => scalar(@review_queue) == 0 && ($source_class_counts{unclassified_source_surface} // 0) == 0
    ? 'COVERAGE_FIRST_RECONCILED_WITHOUT_DELETION_APPROVAL'
    : 'COVERAGE_FIRST_RECONCILIATION_CLASSIFIED_REVIEW_REQUIRED',
  requiredNextProof => [
    'review and accept or reject every reviewRequired candidate',
    'project every accepted reviewRequired candidate through decision JSONL into law/policy artifacts',
    'run refreshed Codex as Gen2 against the unified obligation table after reviewRequired count reaches zero',
  ],
};
write_json("$out_dir/coverage_first_candidate_reconciliation_summary.json", $summary_row);

print $json->encode($summary_row), "\n";
exit(scalar(@reconciled) == scalar(@$semantic_candidates) ? 0 : 1);
