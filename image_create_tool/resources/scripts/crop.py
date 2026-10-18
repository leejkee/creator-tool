"""Example user image processor; crop before any render fitting."""


def process(image, x=0, y=0, width=None, height=None):
    width = image.width - x if width is None else width
    height = image.height - y if height is None else height
    if any(type(value) is not int for value in (x, y, width, height)):
        raise ValueError("裁剪参数必须为整数")
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image.width or y + height > image.height:
        raise ValueError("裁剪范围越出原图")
    return image.crop((x, y, x + width, y + height))
