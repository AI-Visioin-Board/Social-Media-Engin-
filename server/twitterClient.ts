import { TwitterApi } from "twitter-api-v2";
import { ENV } from "./_core/env";

/** Lazy-initialized Twitter client (v2 with v1.1 media upload) */
let _client: TwitterApi | null = null;

function getClient(): TwitterApi {
  if (_client) return _client;
  if (!ENV.twitterApiKey || !ENV.twitterApiSecret || !ENV.twitterAccessToken || !ENV.twitterAccessSecret) {
    throw new Error("Twitter API credentials not configured — set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET");
  }
  _client = new TwitterApi({
    appKey: ENV.twitterApiKey,
    appSecret: ENV.twitterApiSecret,
    accessToken: ENV.twitterAccessToken,
    accessSecret: ENV.twitterAccessSecret,
  });
  return _client;
}

/**
 * Post a tweet with up to 4 images.
 * Downloads images from URLs, uploads to Twitter, then posts.
 * Returns the tweet ID.
 */
export async function postTweet(
  text: string,
  imageUrls: string[],
): Promise<{ tweetId: string; success: boolean }> {
  const client = getClient();

  // Upload up to 4 images (Twitter limit)
  const mediaIds: string[] = [];
  const urlsToUpload = imageUrls.slice(0, 4);

  for (const url of urlsToUpload) {
    try {
      // Download image to buffer
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        console.warn(`[Twitter] Failed to download image: ${url} (HTTP ${res.status})`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      // Upload to Twitter via v1.1 media upload
      const mediaId = await client.v1.uploadMedia(buffer, {
        mimeType: url.includes(".png") ? "image/png" : "image/jpeg",
      });
      mediaIds.push(mediaId);
      console.log(`[Twitter] Uploaded media: ${mediaId}`);
    } catch (err: any) {
      console.warn(`[Twitter] Media upload failed for ${url}:`, err?.message);
    }
  }

  // Post tweet with media
  const tweetPayload: any = { text };
  if (mediaIds.length > 0) {
    tweetPayload.media = { media_ids: mediaIds };
  }

  const tweet = await client.v2.tweet(tweetPayload);
  console.log(`[Twitter] Tweet posted: ${tweet.data.id}`);

  return { tweetId: tweet.data.id, success: true };
}

/**
 * Post a tweet with a video (mp4).
 * Downloads video from URL, uploads via chunked media upload, waits for processing, then posts.
 * Twitter v1.1 chunked upload supports videos up to 512MB.
 */
export async function postTweetWithVideo(
  text: string,
  videoUrl: string,
): Promise<{ tweetId: string; success: boolean }> {
  const client = getClient();

  console.log(`[Twitter] Downloading video from ${videoUrl}...`);
  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`Failed to download video: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`[Twitter] Video downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

  // Upload video via chunked media upload (twitter-api-v2 handles chunking automatically)
  console.log(`[Twitter] Uploading video to Twitter...`);
  const mediaId = await client.v1.uploadMedia(buffer, {
    mimeType: "video/mp4",
    type: "longVideo",
  });
  console.log(`[Twitter] Video uploaded: ${mediaId}`);

  // Post tweet with video
  const tweet = await client.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });
  console.log(`[Twitter] Tweet posted with video: ${tweet.data.id}`);

  return { tweetId: tweet.data.id, success: true };
}
