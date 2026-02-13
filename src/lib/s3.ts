import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

export async function uploadAndGetPresignedUrl(
    config: S3Config,
    fileBuffer: Buffer,
    fileName: string,
    expiresIn: number = 3600
): Promise<string> {
    const s3Client = new S3Client({
        endpoint: config.endpoint,
        region: config.region || 'us-east-1', // Backblaze usually doesn't care much about region if endpoint is provided
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: true, // Often needed for B2
    });

    // 1. Upload the file
    await s3Client.send(
        new PutObjectCommand({
            Bucket: config.bucket,
            Key: fileName,
            Body: fileBuffer,
            ContentType: 'image/jpeg', // Defaulting to jpeg, but ideally we'd detect it
        })
    );

    // 2. Generate a presigned URL for GET
    const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: fileName,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
}
