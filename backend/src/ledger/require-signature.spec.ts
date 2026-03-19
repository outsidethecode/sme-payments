import { BadRequestException } from "@nestjs/common";
import { requireSignature, SignatureData } from "./ledger.service";

describe("requireSignature()", () => {
  const validSig: SignatureData = {
    signature: "base64sig",
    authenticatorData: "base64authData",
    publicKey: "base64pk",
    credentialId: "cred1",
    intentHash: "hash123",
    clientDataJSON: "base64client",
  };

  it("should not throw when a valid signature is provided", () => {
    expect(() => requireSignature(validSig, "PO_SEND")).not.toThrow();
  });

  it("should throw BadRequestException when sig is undefined", () => {
    expect(() => requireSignature(undefined, "PO_SEND")).toThrow(
      BadRequestException,
    );
  });

  it("should throw BadRequestException when sig has empty signature string", () => {
    expect(() =>
      requireSignature({ ...validSig, signature: "" }, "PO_ACCEPT"),
    ).toThrow(BadRequestException);
  });

  it("should include the action name in the error message", () => {
    try {
      requireSignature(undefined, "PO_FUND_ESCROW");
      fail("Expected to throw");
    } catch (err: any) {
      expect(err.message).toContain("PO_FUND_ESCROW");
    }
  });

  it("should include guidance about passkey signing", () => {
    try {
      requireSignature(undefined, "PO_SEND");
      fail("Expected to throw");
    } catch (err: any) {
      expect(err.message).toContain("passkey");
    }
  });

  it("acts as TypeScript type guard (narrows to SignatureData)", () => {
    const maybeSig: SignatureData | undefined = validSig;
    requireSignature(maybeSig, "TEST");
    // After the call, TypeScript knows maybeSig is SignatureData
    const s: SignatureData = maybeSig;
    expect(s.signature).toBe("base64sig");
  });
});
