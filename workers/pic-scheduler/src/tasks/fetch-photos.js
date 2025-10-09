export class FetchPhotosTask {
  async run(env, { page, perPage }) {
    const response = await fetch(
      `https://api.unsplash.com/photos?order_by=latest&per_page=${perPage}&page=${page}&client_id=${env.UNSPLASH_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`Unsplash API failed: ${response.status}`);
    }
    
    return await response.json();
  }
}
