// Credential-free native OpenTofu 1.12 mocked provider tests.
// Synthetic .invalid values; command=plan for every case; no backend/API/effect.
mock_provider "cloudflare" {
  override_during = plan
}

variables {
  account_id              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  zone_id                 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  zone_name               = "example.invalid"
  alias_address           = "m0@example.invalid"
  destination_address     = "private@example.invalid"
  verified_destination_id = "cccccccccccccccccccccccccccccccc"
  rule_priority           = 0
}

run "default_no_effect" {
  command = plan
  assert {
    condition = (
      length(cloudflare_email_routing_dns.zone) == 0
      && length(cloudflare_email_routing_address.gmail) == 0
      && length(cloudflare_email_routing_rule.literal) == 0
    )
    error_message = "Default root must manage no Cloudflare objects."
  }
}

run "preflight_missing" {
  command = plan
  variables {
    manage_rule = true
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "private@example.invalid"
      verified = "2026-10-08T00:00:00Z"
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = true
      status  = "ready"
    }
  }
  expect_failures = [cloudflare_email_routing_rule.literal]
}

run "unverified_destination" {
  command = plan
  variables {
    manage_rule        = true
    preflight_approved = true
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "private@example.invalid"
      verified = null
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = true
      status  = "ready"
    }
  }
  expect_failures = [cloudflare_email_routing_rule.literal]
}

run "all_three_flags_initial_unverified" {
  command = plan
  variables {
    manage_dns         = true
    manage_destination = true
    manage_rule        = true
    preflight_approved = true
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "private@example.invalid"
      verified = null
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = false
      status  = "unconfigured"
    }
  }
  expect_failures = [cloudflare_email_routing_rule.literal]
}

run "dns_not_ready" {
  command = plan
  variables {
    manage_rule        = true
    preflight_approved = true
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "private@example.invalid"
      verified = "2026-10-08T00:00:00Z"
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = false
      status  = "unconfigured"
    }
  }
  expect_failures = [cloudflare_email_routing_rule.literal]
}

run "wrong_verified_destination" {
  command = plan
  variables {
    manage_rule        = true
    preflight_approved = true
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "other@example.invalid"
      verified = "2026-10-08T00:00:00Z"
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = true
      status  = "ready"
    }
  }
  expect_failures = [cloudflare_email_routing_rule.literal]
}

run "verified_shared_reuse" {
  command = plan
  variables {
    manage_rule        = true
    preflight_approved = true
    manage_destination = false
    manage_dns         = false
  }
  override_data {
    target = data.cloudflare_email_routing_address.checked
    values = {
      email    = "private@example.invalid"
      verified = "2026-10-08T00:00:00Z"
    }
  }
  override_data {
    target = data.cloudflare_email_routing_settings.checked
    values = {
      enabled = true
      status  = "ready"
    }
  }
  assert {
    condition = (
      length(cloudflare_email_routing_rule.literal) == 1
      && length(cloudflare_email_routing_address.gmail) == 0
      && length(cloudflare_email_routing_dns.zone) == 0
    )
    error_message = "Verified existing destination and ready DNS should plan one rule, without recreating shared resources."
  }
}
