import { Repository } from "typeorm";
import { Review } from "../entities/Review";
import { User } from "../entities/User";
import { SellerProfile } from "../entities/SellerProfile";
import { CreateReviewDto } from "../dto/user/CreateReviewDto";

export class ReviewService {
  constructor(
    private reviewRepository: Repository<Review>,
    private userRepository: Repository<User>,
    private sellerRepository: Repository<SellerProfile>
  ) {}

  async createReview(data: CreateReviewDto): Promise<Review> {
    const { sellerId, reviewerId, rating, comment } = data;
    
    if (rating < 1 || rating > 5) {
        throw new Error("Rating must be between 1 and 5");
    }

    // Find seller
    const seller = await this.sellerRepository.findOne({ where: { userId: sellerId } });
    if (!seller) {
        throw new Error("Seller not found");
    }

    // Find reviewer user with both profiles
    const reviewerUser = await this.userRepository.findOne({
        where: { id: reviewerId },
        relations: ["buyerProfile", "sellerProfile"],
    });

    if (!reviewerUser) {
        throw new Error("User not found");
    }

    // Check for either buyer or seller profile
    const reviewer = reviewerUser.buyerProfile || reviewerUser.sellerProfile;
    if (!reviewer) {
        throw new Error("User must have either a buyer or seller profile to leave a review");
    }

    // Create review
    const review = this.reviewRepository.create({
      seller,
      rating,
      comment,
  });

  if (reviewerUser.buyerProfile) {
      review.buyerReviewer = reviewerUser.buyerProfile;
  } else if (reviewerUser.sellerProfile) {
      review.sellerReviewer = reviewerUser.sellerProfile;
  }

    const savedReview = await this.reviewRepository.save(review);

    // Increment numReviews
    await this.sellerRepository
        .createQueryBuilder()
        .update(SellerProfile)
        .set({ numReviews: () => "numReviews + 1" })
        .where("id = :sellerId", { sellerId: seller.id })
        .execute();

    return savedReview;
}

  async getSellerStats(sellerId: number): Promise<{ averageRating: number; totalReviews: number }> {
    const reviews = await this.reviewRepository
      .createQueryBuilder('review')
      .where('review.sellerId = :sellerId', { sellerId })
      .select([
        'COUNT(*) as totalReviews',
        'AVG(review.rating) as averageRating'
      ])
      .getRawOne();
  
    return {
      averageRating: Number(reviews.averageRating) || 0,
      totalReviews: Number(reviews.totalReviews) || 0
    };
  }

  async getSellerReviews(sellerId: number, page: number = 1, limit: number = 5): Promise<{ reviews: Review[]; total: number; hasMore: boolean }> {
    const [reviews, total] = await this.reviewRepository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.buyer', 'buyer')
      .leftJoinAndSelect('buyer.user', 'user')
      .where('review.sellerId = :sellerId', { sellerId })
      .orderBy('review.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  
    return {
      reviews,
      total,
      hasMore: total > page * limit
    };
  }

  async addReplyToReview(reviewId: number, sellerId: number, comment: string): Promise<Review> {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId }, relations: ["seller"] });

    if (!review) {
      throw new Error("Review not found");
    }

    if (review.seller.id !== sellerId) {
      throw new Error("Only the seller can reply to this review");
    }

    if (review.reply) {
      throw new Error("Review already has a reply");
    }

    review.reply = { comment, createdAt: new Date() };

    return this.reviewRepository.save(review);
  }

  async reportReview(reviewId: number, reporterId: number, reason: string) {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId } });

    if (!review) {
      throw new Error("Review not found");
    }

    review.reported = true;
    review.reportReason = reason;
    review.reporterId = reporterId;

    return this.reviewRepository.save(review);
  }

  async deleteReview(reviewId: number, userId: number): Promise<void> {
    const review = await this.reviewRepository.findOne({ where: { id: reviewId }, relations: ["buyer", "seller"] });

    if (!review) {
      throw new Error("Review not found");
    }

    if ((review.buyerReviewer && review.buyerReviewer.id !== userId) || (review.sellerReviewer && review.sellerReviewer.id !== userId)) {
      throw new Error("Only the reviewer can delete this review");
    }

    await this.reviewRepository.remove(review);

    // Decrement numReviews
    await this.sellerRepository
      .createQueryBuilder()
      .update(SellerProfile)
      .set({ numReviews: () => "numReviews - 1" })
      .where("id = :sellerId", { sellerId: review.seller.id })
      .execute();
  }
}
