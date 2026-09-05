# CloudFront in front of the two S3 buckets. Optional (var.enable_cdn) because
# it adds ~15 min to deploy; when off, the app uses the S3 regional domains.
resource "aws_cloudfront_origin_access_control" "media" {
  count                             = var.enable_cdn ? 1 : 0
  name                              = "${local.name}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  count               = var.enable_cdn ? 1 : 0
  enabled             = true
  comment             = "${local.name} media CDN"
  default_root_object = ""

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 0
    default_ttl = 60
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

# OAC read grant so the app-dist CloudFront can serve the bucket (e.g. the
# /admin/ ops console). Without this the distribution 403s every object.
data "aws_iam_policy_document" "app_dist_oac" {
  count = var.enable_cdn ? 1 : 0
  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.app_dist.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app_dist[0].arn]
    }
  }
}
resource "aws_s3_bucket_policy" "app_dist" {
  count      = var.enable_cdn ? 1 : 0
  bucket     = aws_s3_bucket.app_dist.id
  policy     = data.aws_iam_policy_document.app_dist_oac[0].json
  depends_on = [aws_s3_bucket_public_access_block.app_dist]
}

resource "aws_cloudfront_distribution" "app_dist" {
  count   = var.enable_cdn ? 1 : 0
  enabled = true
  comment = "${local.name} app-distribution CDN"

  origin {
    domain_name              = aws_s3_bucket.app_dist.bucket_regional_domain_name
    origin_id                = "appdist"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "appdist"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 0
    default_ttl = 60
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
