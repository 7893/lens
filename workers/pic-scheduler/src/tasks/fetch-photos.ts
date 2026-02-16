export class FetchPhotosTask {
  async run(env: Env, { page, perPage }: { page: number; perPage: number }): Promise<unknown[]> {
    const response = await fetch(
      `https://api.unsplash.com/photos?order_by=latest&per_page=${perPage}&page=${page}&client_id=${env.UNSPLASH_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Unsplash API failed: ${response.status}`);
    }

    return await response.json();
  }
}
