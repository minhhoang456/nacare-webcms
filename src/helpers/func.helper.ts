import crypto from "crypto";
import ono from "@jsdevtools/ono";
import appRoot from "app-root-path";
import fs from "fs";
import Handlebars from "handlebars";
import path from "path";
const nodemailer = require("nodemailer") as any;
const mailUser = process.env.ADMIN_EMAIL || "nacare@media-one.vn";
const mailPassword = process.env.ADMIN_PASSWORD || "Nacare@123";

export function easierLookup(array: any[], key: string | number) {
  const easier: any = {};
  array.forEach(function (i: any) {
    easier[i[key]] = i;
  });
  return easier;
}
export function joinArrWithCondition(
  firstArr: any[],
  firtKey: string | number,
  secondArr: any,
  secondKey: any,
  keyName: string | number,
) {
  const easierArr = easierLookup(secondArr, secondKey);
  firstArr.forEach(function (e: any) {
    e[keyName] = easierArr[e[firtKey]];
  });
  return firstArr;
}

export async function getCompiledTemplate(
  templateName: string,
): Promise<HandlebarsTemplateDelegate> {
  const templatePath = path.join(
    appRoot.toString(),
    `assets/tmp_instruction/${templateName}.hbs`,
  );
  const templateContent = await new Promise<string>((resolve, reject) => {
    fs.readFile(templatePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
  return Handlebars.compile(templateContent);
}

export async function sendMail(prarams: any) {
  try {
    const { templateName, subject, context } = prarams;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: mailUser,
        pass: mailPassword,
      },
    });
    const template = await getCompiledTemplate(templateName);
    const html = template(context);
    const options: any = {
      from: mailUser,
      to: context.receiveEmail,
      subject,
      html,
    };
    const rs = await new Promise((resolve, _reject) => {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
      transporter.sendMail(options, (err: any, _info: any) => {
        if (err) {
          console.log(
            "🚀 ~ file: func.helper.ts:55 ~ transporter.sendMail ~ err:",
            err,
          );
          resolve(false);
        } else {
          console.log("🚀 ~ send mail success");
          resolve(true);
        }
      });
    });
    return rs;
  } catch (err: any) {
    console.log("🚀 ~ file: func.helper ~ sendMail ~ err:", err.message);
    throw ono("send_mail_failed");
  }
}

export function generateOTP() {
  const otp = Math.floor(Math.random() * 10000);
  return otp.toString().padStart(4, "0");
}

export function isPhone(phone: string): boolean {
  return /^(84|0)(3|5|7|8|9|1[2689])[0-9]{8}$/.test(phone);
}

export function isEmail(emailOrPhone: string): boolean {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(emailOrPhone).toLowerCase());
}

export function generateInviteCode(length = 9): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(crypto.randomInt(0, characters.length));
  }
  return result;
}
