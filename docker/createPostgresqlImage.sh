## getting information regarding the machine architecture
OS= && dpkgArch="$(uname -m)"
case "${dpkgArch##*-}" in
    amd64) OS='linux';;
    x86_64) OS='linux';;
    arm64) OS='linux-arm';;
    *) OS='linux';;
esac

## fetching the appropriate jre from github
curl -o jre.zip -s -X GET \
	"https://raw.githubusercontent.com/supertokens/jre/master/jre-21.0.7-${OS}.zip"

## fetching docker-entrypoint.sh from github if file doesn't exists
if [ ! -f docker-entrypoint.sh ]; then
    curl -o docker-entrypoint.sh -s -X GET \
    "https://raw.githubusercontent.com/supertokens/supertokens-docker-postgresql/master/docker-entrypoint.sh"
fi

## marking docker-entrypoint.sh as executable
chmod +x docker-entrypoint.sh

## unzipping the jre zip and removing the zip file once extracted
unzip jre.zip && mv jre-* jre && rm -rf jre.zip

rm -rf __MACOSX

## copying all the necessary files and folders
cp -r ../core core
cp -r ../cli cli
cp -r ../downloader downloader
cp -r ../ee ee
cp -r ../plugin-interface plugin-interface
cp -r ../plugin plugin
cp -r ../install ./
cp -r ../version.yaml ./

## building the docker image
docker build -t supertokens-postgresql-testing .

## removing all the files and folders previously copied or extracted
rm -rf core
rm -rf cli
rm -rf ee
rm -rf downloader
rm -rf plugin-interface
rm -rf plugin
rm -rf install
rm -rf version.yaml
rm -rf jre