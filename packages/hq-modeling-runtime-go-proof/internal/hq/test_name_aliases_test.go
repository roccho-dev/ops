package hq

var inventoryTestNameAliases = map[string]string{
	"TestCLIProofBoundaryAndHelpMeanings":                        "TestCLIExposesProofBoundaryAndUsage",
	"TestCoreCLIRequiredSerializedMeanings":                      "TestCLICommandsPreserveJSONLContracts",
	"TestPromotionCLIRequiredSerializedMeanings":                 "TestPromotionCLIIsReadOnlyAndFailClosed",
	"TestQueueValidatorRequiredSerializedMeanings":               "TestQueueValidationIsExplicitAndFailClosed",
	"TestAuthorityVocabularyRequiredSerializedMeanings":          "TestAuthorityVocabularyIsBoundedAndFailClosed",
	"TestSourceAndReconcileRowsCannotBeSmuggledIntoModelPayload": "TestModelPayloadRejectsSourceAndReconcileRows",
	"TestLocalWorkerRequiredSerializedMeanings":                  "TestWorkerPreservesQueueIntentBoundaries",
	"TestAgentTaskRemainsPendingEvidenceAndNeverAdmission":       "TestAgentTasksRemainPendingAndNonAuthoritative",
	"TestReceiptWriterRequiredSerializedMeanings":                "TestReceiptsAreDeterministicEvidence",
	"TestProjectionRequiredSerializedMeanings":                   "TestProjectionIsDeterministicAndNonAuthoritative",
	"TestAdmissionRequiredSerializedMeanings":                    "TestAdmissionAcceptsOnlyModelCommitIntent",
	"TestModelingProposalRequiredSerializedMeanings":             "TestProposalValidationIsCanonicalAndFailClosed",
	"TestPromotionRequiredSerializedMeanings":                    "TestPromotionRequiresBoundHumanConfirmation",
	"TestPromotionContinuityAndTamperDetection":                  "TestPromotionRejectsContinuityBreaksAndTampering",
	"TestPromotionOutputIsDetachedFromCallerInput":               "TestPromotionOutputDoesNotAliasInput",
	"TestSerializedDeepNestingHasBoundedResourceGrowth":          "TestDeepNestingUsesBoundedResources",
	"TestValidQueueRunsThroughProofPipeline":                     "TestQueueFlowsFromValidationToProjection",
	"TestAuthorityAndSourceSmugglingFailClosed":                  "TestQueueRejectsAuthorityAndSourceSmuggling",
	"TestStableStringifyMatchesNodeFixture":                      "TestCanonicalJSONMatchesNodeOracle",
	"TestVisitJSONLLinesHasNoScannerTokenCeiling":                "TestJSONLReaderAcceptsLargeRecords",
}
