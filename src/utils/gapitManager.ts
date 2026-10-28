import Conf from "@src/services/conf";
import request from "./request";

export default class GapitManager {
  private static instance: GapitManager;
  private config!: {
    baseUrlAuth: string;
    baseUrlSendMessage: string;
    clientId: string;
    clientSecret: string;
    oa: {
      oaid: string;
      oa_name: string;
      template_id: string;
    };
    sms: {
      from: string;
      template_data: string;
    };
  };
  private authorizationGetToken!: string;
  private accessToken: string;
  private accessTokenExpiresAt: number;
  private readonly TOKEN_REFRESH_THRESHOLD = 300;

  private constructor() {
    this.accessToken = "";
    this.accessTokenExpiresAt = 0;
    this.loadConfig();

    setInterval(
      () => {
        console.log("Reloading GapitManager config...");
        this.loadConfig();
      },
      5 * 60 * 1000,
    );
  }

  static getInstance(): GapitManager {
    return (GapitManager.instance ??= new GapitManager());
  }

  private loadConfig() {
    this.config = {
      baseUrlAuth: Conf.get("gapit.baseUrlAuth", "https://auth.gapone.vn"),
      baseUrlSendMessage: Conf.get(
        "gapit.baseUrlSendMessage",
        "https://gateway.gapone.vn",
      ),
      clientId: Conf.get("gapit.clientId", "SfCWPIj49NKHKEKY"),
      clientSecret: Conf.get(
        "gapit.clientSecret",
        "6UbebuOVU4GQ_U9wiOBu-buybAZzr_rx",
      ),
      oa: {
        oaid: Conf.get("gapit.oaid", "2972818141398107245"),
        oa_name: Conf.get("gapit.oa_name", "Nacare"),
        template_id: Conf.get("gapit.template_id", "403050"),
      },
      sms: {
        from: Conf.get("gapit.sms.from", "Nacare"),
        template_data: Conf.get(
          "gapit.template_data",
          `[Nacare] - Ma OTP de dang nhap tren web nacare.com.vn la`,
        ),
      },
    };
    this.authorizationGetToken = `Basic ${Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64")}`;
  }

  private generateRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${random}`;
  }

  private async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const hasToken =
      this.accessToken &&
      this.accessTokenExpiresAt > now + this.TOKEN_REFRESH_THRESHOLD;

    if (hasToken) return this.accessToken;

    const response = await request({
      method: "POST",
      url: `${this.config.baseUrlAuth}/token`,
      headers: {
        Authorization: this.authorizationGetToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: {
        grant_type: "client_credentials",
        scope: "gateway",
      },
    });
    //** response data {"access_token":"2YotnFZFEjr1zCsicMWpAA","token_type":"bearer","scope":"gateway","expires_in":3600}*/
    this.accessToken = response.access_token;
    this.accessTokenExpiresAt = now + response.expires_in;
    return this.accessToken;
  }

  async sendOTP(otp: string, customerPhone: string): Promise<any> {
    if (otp.length > 10) {
      throw new Error("OTP không được quá 10 ký tự");
    }
    const token = await this.getToken();
    const response = await request({
      method: "POST",
      url: `${this.config.baseUrlSendMessage}/a2p-request`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        request_id: this.generateRequestId(),
        message: {
          channel: "zalo",
          from: this.config.oa.oaid,
          to: customerPhone,
          template_id: this.config.oa.template_id,
          template_data: {
            otp: otp,
          },
        },
        fallback: [
          {
            channel: "sms",
            from: this.config.sms.from,
            to: customerPhone,
            content: {
              text: `${this.config.sms.template_data} ${otp}`,
              msg_type: "text",
              sms_type: "CSKH",
            },
          },
        ],
      },
    });
    return response;
  }
}
