import {
  Controller,
  Post,
  Get,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Request,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { EvidenceService, EvidenceTypeValue } from "./evidence.service";
import { Response } from "express";

@Controller("evidence")
@UseGuards(JwtAuthGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  /**
   * Upload evidence for a purchase order.
   * POST /evidence/upload
   * multipart/form-data: file, purchaseOrderId, type, description?
   */
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body("purchaseOrderId") purchaseOrderId: string,
    @Body("type") type: EvidenceTypeValue,
    @Body("description") description: string,
    @Request() req: any,
  ) {
    if (!file) {
      return { statusCode: 400, message: "No file provided" };
    }
    if (!purchaseOrderId || !type) {
      return {
        statusCode: 400,
        message: "purchaseOrderId and type are required",
      };
    }

    return this.evidenceService.upload({
      purchaseOrderId,
      uploaderId: req.user.id,
      uploaderRole: req.user.role,
      type,
      description,
      file: {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
    });
  }

  /**
   * List evidence for a PO.
   * GET /evidence/po/:poId
   */
  @Get("po/:poId")
  async listByPO(@Param("poId") poId: string) {
    return this.evidenceService.findByPO(poId);
  }

  /**
   * Download a single attachment.
   * GET /evidence/:id/download
   */
  @Get(":id/download")
  async download(@Param("id") id: string, @Res() res: Response) {
    const { buffer, filename, mimeType } =
      await this.evidenceService.getFileBuffer(id);
    res.set({
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  }

  /**
   * Verify an attachment's integrity.
   * GET /evidence/:id/verify
   */
  @Get(":id/verify")
  async verify(@Param("id") id: string) {
    return this.evidenceService.verifyIntegrity(id);
  }

  /**
   * Get the full evidence pack for a PO (JSON manifest).
   * GET /evidence/po/:poId/pack
   */
  @Get("po/:poId/pack")
  async evidencePack(@Param("poId") poId: string) {
    return this.evidenceService.buildEvidencePack(poId);
  }
}
