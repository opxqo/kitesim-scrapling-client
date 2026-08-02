import { describe, expect, it } from "vitest"

import {
  buildAccountGroups,
  displayMessageContent,
  displaySensitiveIdentifier,
  firstCodeRecord,
  maskPhoneNumber,
  orderKey,
  privacyMessageOptions,
  statusCountsFromOrders,
} from "./dashboard"
import type { KitesimMessage, KitesimOrder } from "@/types"

const orders: KitesimOrder[] = [
  {
    id: 101,
    accountId: "acct_primary",
    accountLabel: "主号码",
    messageHandle: "signed-primary",
    phoneNumber: "+15550000001",
    orderStatus: 2,
    statusLabel: "使用中",
  },
  {
    id: 202,
    accountId: "acct_secondary",
    accountLabel: "备用号码",
    messageHandle: "signed-secondary",
    phoneNumber: "+447400123831",
    orderStatus: 1,
    statusLabel: "激活中",
  },
]

describe("dashboard domain helpers", () => {
  it("builds a stable account-scoped order key", () => {
    expect(orderKey(orders[0])).toBe("acct_primary:101")
  })

  it("masks international phone numbers while preserving recognition", () => {
    expect(maskPhoneNumber("+15550000001")).toBe("+1 555 ••• •001")
    expect(maskPhoneNumber("+447400123831")).toBe("+44 7400 ••• •831")
  })

  it("derives every message visibility flag from the global privacy switch", () => {
    expect(privacyMessageOptions(true)).toEqual({ revealCode: false, showSms: false })
    expect(privacyMessageOptions(false)).toEqual({ revealCode: true, showSms: true })
  })

  it("masks phone-like account and sender labels with the global privacy switch", () => {
    expect(displaySensitiveIdentifier("+1-555-000-0001", true)).toBe("+1 555 ••• •001")
    expect(displaySensitiveIdentifier("主账户 +1-555-000-0001", true)).toBe("主账户 +1 555 ••• •001")
    expect(displaySensitiveIdentifier("+1-555-000-0001", false)).toBe("+1-555-000-0001")
    expect(displaySensitiveIdentifier("主账户", true)).toBe("主账户")
  })

  it("fails closed when rendering SMS content under the privacy mask", () => {
    expect(displayMessageContent("Your code is 438921", true)).toBe("短信正文已隐藏")
    expect(displayMessageContent("Your code is 438921", false)).toBe("Your code is 438921")
    expect(displayMessageContent("", false)).toBe("无短信正文")
  })

  it("groups orders by account without losing account labels", () => {
    expect(buildAccountGroups(orders)).toEqual([
      {
        accountId: "acct_primary",
        accountLabel: "主号码",
        orders: [orders[0]],
      },
      {
        accountId: "acct_secondary",
        accountLabel: "备用号码",
        orders: [orders[1]],
      },
    ])
  })

  it("finds the first message carrying a verification code", () => {
    const input: KitesimMessage[] = [
      { id: 1, sender: "Service", content: "No code", code: [] },
      { id: 2, sender: "Google", content: "Code", code: ["438921"] },
    ]
    expect(firstCodeRecord(input)).toEqual({ code: "438921", message: input[1] })
  })

  it("counts only statuses present in the current order set", () => {
    expect(statusCountsFromOrders(orders)).toEqual({ 1: 1, 2: 1, all: 2 })
  })
})
