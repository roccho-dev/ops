#!/usr/bin/env perl
use strict;
use warnings;
use Getopt::Long qw(GetOptions);
use JSON::PP;

my ($evidence_dir, $out_dir, $policy_input_ref, $packet_size);
$packet_size = 100;
GetOptions(
  'evidence-dir=s'     => \$evidence_dir,
  'out-dir=s'          => \$out_dir,
  'policy-input-ref=s' => \$policy_input_ref,
  'packet-size=i'      => \$packet_size,
) or die "usage: $0 --evidence-dir PATH --out-dir PATH --policy-input-ref REF [--packet-size N]\n";

die "missing --evidence-dir\n" unless defined $evidence_dir && length $evidence_dir;
die "missing --out-dir\n" unless defined $out_dir && length $out_dir;
die "missing --policy-input-ref\n" unless defined $policy_input_ref && length $policy_input_ref;
die "packet size must be positive\n" unless $packet_size > 0;

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

sub expected_behavior {
  my ($row) = @_;
  my $polarity = $row->{polarity} // '';
  my $modal = $row->{modal} // '';

  my $behavior_class =
    $polarity eq 'deny' ? 'must-reject-or-avoid' :
    $polarity eq 'allow' ? 'may-allow-with-boundary' :
    'must-uphold-or-check';

  my $strength =
    $modal eq 'mandatory' ? 'enforced' :
    $modal eq 'reviewed' ? 'reviewed-accepted-proposal' :
    $modal eq 'review' ? 'review-required' :
    $modal eq 'candidate' ? 'candidate-preserved' :
    'unspecified-modal';

  my $instruction =
    $polarity eq 'deny'
      ? 'A compliant Gen2 operation must not perform, approve, or treat as authority behavior prohibited by this row.'
      : $polarity eq 'allow'
        ? 'A compliant Gen2 operation may allow this behavior only within the row boundary and must not elevate it to broader authority.'
        : 'A compliant Gen2 operation must preserve this row as a law constraint, route/check against it when relevant, and not contradict it.';

  return ($behavior_class, $strength, $instruction);
}

my $rows = read_jsonl("$evidence_dir/legacy_policy_exhaustive_obligation_table.proposed.jsonl");

my (@expected, @packets);
my (%lane_counts, %behavior_counts, %strength_counts, %polarity_counts);

for my $row (@$rows) {
  my ($behavior_class, $strength, $instruction) = expected_behavior($row);
  my $expected_row = {
    type => 'policy.retirement.gen2LawBehaviorExpectation.proposed.v1',
    policyInputRef => $policy_input_ref,
    rowIndex => $row->{index},
    sourceLane => $row->{sourceLane},
    sourcePath => $row->{sourcePath},
    sourceId => $row->{sourceId},
    signalId => $row->{signalId},
    modal => $row->{modal},
    polarity => $row->{polarity},
    text => $row->{text},
    projectedRule => $row->{projectedRule},
    expectedBehaviorClass => $behavior_class,
    expectedStrength => $strength,
    expectedInstruction => $instruction,
    gen2OperationRequirement => 'read-row-then-state-pass-fail-and-reason-without-claiming-canonical-approval',
    authorityState => $row->{authorityState},
    deletionApproval => JSON::PP::false,
    cutoverReady => JSON::PP::false,
  };
  push @expected, $expected_row;
  $lane_counts{$row->{sourceLane} // 'unknown'}++;
  $behavior_counts{$behavior_class}++;
  $strength_counts{$strength}++;
  $polarity_counts{$row->{polarity} // 'unknown'}++;
}

for (my $offset = 0; $offset < @expected; $offset += $packet_size) {
  my @slice = @expected[$offset .. (($offset + $packet_size - 1) < $#expected ? ($offset + $packet_size - 1) : $#expected)];
  my $packet_index = scalar(@packets) + 1;
  my $packet_id = sprintf('gen2-law-behavior-packet-%03d', $packet_index);
  my %packet_lanes;
  my %packet_behaviors;
  $packet_lanes{$_->{sourceLane} // 'unknown'}++ for @slice;
  $packet_behaviors{$_->{expectedBehaviorClass} // 'unknown'}++ for @slice;
  push @packets, {
    type => 'policy.retirement.gen2LawBehaviorPacket.proposed.v1',
    packetId => $packet_id,
    packetIndex => $packet_index,
    rowStart => $slice[0]->{rowIndex},
    rowEnd => $slice[-1]->{rowIndex},
    rowCount => scalar(@slice),
    sourceLaneCounts => \%packet_lanes,
    expectedBehaviorCounts => \%packet_behaviors,
    verificationInstruction => 'Refreshed Codex as Gen2 must inspect every rowRef and return PASS only if the row has a clear expected law behavior and does not claim canonical approval, deletion, or cutover.',
    rowRefs => [
      map {
        {
          rowIndex => $_->{rowIndex},
          sourceLane => $_->{sourceLane},
          sourcePath => $_->{sourcePath},
          sourceId => $_->{sourceId},
          signalId => $_->{signalId},
          polarity => $_->{polarity},
          expectedBehaviorClass => $_->{expectedBehaviorClass},
          expectedStrength => $_->{expectedStrength},
          projectedRule => $_->{projectedRule},
        }
      } @slice
    ],
  };
}

write_jsonl("$out_dir/gen2_law_behavior_expectations.proposed.jsonl", \@expected);
write_jsonl("$out_dir/gen2_law_behavior_packets.proposed.jsonl", \@packets);

open my $md, '>:encoding(UTF-8)', "$out_dir/gen2_law_behavior_packet_index.proposed.md"
  or die "write $out_dir/gen2_law_behavior_packet_index.proposed.md: $!";
print {$md} "| # | packet | rows | count | lanes | behaviors |\n";
print {$md} "|---:|---|---|---:|---|---|\n";
for my $packet (@packets) {
  my $lanes = join(', ', map { "$_=$packet->{sourceLaneCounts}{$_}" } sort keys %{ $packet->{sourceLaneCounts} });
  my $behaviors = join(', ', map { "$_=$packet->{expectedBehaviorCounts}{$_}" } sort keys %{ $packet->{expectedBehaviorCounts} });
  print {$md} '| ', $packet->{packetIndex},
    ' | `', md_escape($packet->{packetId}), '`',
    ' | ', $packet->{rowStart}, '-', $packet->{rowEnd},
    ' | ', $packet->{rowCount},
    ' | ', md_escape($lanes),
    ' | ', md_escape($behaviors),
    " |\n";
}
close $md;

my $summary = {
  type => 'policy.retirement.gen2LawBehaviorPacketSummary.proposed.v1',
  policyInputRef => $policy_input_ref,
  exhaustiveObligationRows => scalar(@$rows),
  expectationRows => scalar(@expected),
  packetRows => scalar(@packets),
  packetSize => $packet_size,
  sourceLaneCounts => \%lane_counts,
  polarityCounts => \%polarity_counts,
  expectedBehaviorCounts => \%behavior_counts,
  expectedStrengthCounts => \%strength_counts,
  deletionApproval => JSON::PP::false,
  cutoverReady => JSON::PP::false,
  authorityState => 'proposal-verification-packets-not-canonical-approval',
  decision => scalar(@expected) == scalar(@$rows) ? 'GEN2_LAW_BEHAVIOR_PACKETS_MATERIALIZED' : 'GEN2_LAW_BEHAVIOR_PACKETS_INCOMPLETE',
  requiredNextProof => [
    'run refreshed Codex as Gen2 against all packets',
    'persist Gen2 pass/fail/readback evidence',
    'do not treat packet verification as canonical law approval',
  ],
};
write_json("$out_dir/gen2_law_behavior_packet_summary.proposed.json", $summary);

print $json->encode($summary), "\n";
exit(scalar(@expected) == scalar(@$rows) ? 0 : 1);
