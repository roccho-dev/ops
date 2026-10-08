// M0: one Cloudflare Email Routing literal alias to an existing, Owner-verified Gmail.
// Neither this root nor a successful "tofu validate" grants permission to mutate a zone.
// PREPARE must independently read the current NS/MX/SPF/DKIM/DMARC, all rules,
// catch-all and shared account destinations, and choose one state owner before planning.
// All three manages default false; never adopt or destroy a shared destination by accident.
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.21.1"
    }
  }

  // Partial backend; bucket, key, endpoint and credentials are chosen by the
  // authorized state Owner after preflight. This is the STATE backend, not Mail R2 Hot.
  backend "s3" {
    region                      = "auto"
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  // A later authorized effect must provide the private TF_ENCRYPTION material.
  // No unencrypted remote state or plan is permitted.
  encryption {
    state {
      enforced = true
    }
    plan {
      enforced = true
    }
  }
}

// All values are supplied privately by the Owner; no real domain or mailbox
// appears in Git, a public plan, CI variables, comments, or the provider lock.
variable "account_id" {
  type        = string
  description = "Owner-approved Cloudflare account containing the Gmail destination."
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be the exact 32-character Cloudflare account ID."
  }
}

variable "zone_id" {
  type        = string
  description = "Owner-approved Cloudflare zone; independent MX preflight required."
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be the exact 32-character Cloudflare zone ID."
  }
}

variable "zone_name" {
  type        = string
  description = "Actual zone name, not a catch-all or an assumed subdomain."
  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9.-]+[A-Za-z0-9]$", var.zone_name))
    error_message = "zone_name must be one explicit DNS name."
  }
}

variable "alias_address" {
  type        = string
  description = "Exactly one literal recipient address, in the approved zone."
  sensitive   = true
  validation {
    condition = (
      can(regex("^[A-Za-z0-9][A-Za-z0-9._+%-]*@[A-Za-z0-9.-]+$", var.alias_address))
      && endswith(lower(var.alias_address), format("@%s", lower(var.zone_name)))
    )
    error_message = "alias_address must be one literal mailbox in zone_name; no wildcard or catch-all."
  }
}

variable "destination_address" {
  type        = string
  description = "Gmail destination supplied privately by the Owner; must be verified separately."
  sensitive   = true
  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+$", var.destination_address))
    error_message = "destination_address must be one mailbox address."
  }
}

variable "rule_priority" {
  type        = number
  description = "Explicit priority selected after examining ALL existing rules and precedence."
  validation {
    condition     = var.rule_priority >= 0 && floor(var.rule_priority) == var.rule_priority
    error_message = "rule_priority must be a nonnegative integer based on readback."
  }
}

// Manage flags are explicit; an empty or unknown target never means create.
// A root already owning any object must import/identify that object before
// enabling its corresponding flag. Existing shared verified destinations are
// read-only references: manage_destination = false.
variable "manage_dns" {
  type    = bool
  default = false
}

variable "manage_destination" {
  type    = bool
  default = false
}

variable "manage_rule" {
  type    = bool
  default = false
}

variable "preflight_approved" {
  type        = bool
  default     = false
  description = "Plan guard ONLY; independent Owner Effect GO and provider/readback gates remain mandatory."
}

resource "cloudflare_email_routing_dns" "zone" {
  count   = var.manage_dns ? 1 : 0
  zone_id = var.zone_id
  name    = var.zone_name

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.preflight_approved
      error_message = "Read-only zone MX/SPF/DKIM/DMARC safety preflight and Owner approval are required."
    }
  }
}

// Account destinations are shared across zones; do not manage or destroy an
// existing Gmail destination just because this one alias uses it.
resource "cloudflare_email_routing_address" "gmail" {
  count      = var.manage_destination ? 1 : 0
  account_id = var.account_id
  email      = var.destination_address

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.preflight_approved
      error_message = "Owner must authorize creating a NEW account destination; reuse existing verified ones."
    }
  }
}

// Separate live stages: a forwarding rule reads the actual account destination
// and zone settings. It cannot treat a newly created, unverified destination as
// verified, or assume DNS became ready during the same apply.
variable "verified_destination_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Owner-read account destination identifier (verified before rule stage)."
  validation {
    condition     = var.verified_destination_id == null || can(regex("^[0-9a-f]{32}$", var.verified_destination_id))
    error_message = "verified_destination_id must be the exact Cloudflare destination ID."
  }
}

data "cloudflare_email_routing_address" "checked" {
  count                          = var.manage_rule ? 1 : 0
  account_id                     = var.account_id
  destination_address_identifier = var.verified_destination_id
}

data "cloudflare_email_routing_settings" "checked" {
  count   = var.manage_rule ? 1 : 0
  zone_id = var.zone_id
}

// Provider 5.21.1 does not accept a configurable source field here; a Terraform
// rule is API-owned. Never import/take over source=wrangler or an earlier
// matcher of different ownership. Enabled alone does not prove effective route.
resource "cloudflare_email_routing_rule" "literal" {
  count    = var.manage_rule ? 1 : 0
  zone_id  = var.zone_id
  name     = "M0: one literal mailbox to verified Gmail"
  enabled  = true
  priority = var.rule_priority

  matchers = [{
    type  = "literal"
    field = "to"
    value = var.alias_address
  }]

  actions = [{
    type  = "forward"
    value = [data.cloudflare_email_routing_address.checked[0].email]
  }]

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.preflight_approved && var.verified_destination_id != null
      error_message = "An Owner-approved destination ID and independent preflight are required."
    }

    precondition {
      condition = (
        data.cloudflare_email_routing_address.checked[0].verified != null
        && lower(data.cloudflare_email_routing_address.checked[0].email) == lower(var.destination_address)
      )
      error_message = "Account destination is unverified or differs from approved Gmail. STOP."
    }

    precondition {
      condition = (
        data.cloudflare_email_routing_settings.checked[0].enabled == true
        && data.cloudflare_email_routing_settings.checked[0].status == "ready"
      )
      error_message = "Email Routing DNS must already be enabled and ready before creating a rule."
    }
  }
}
